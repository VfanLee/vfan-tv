mod playlist;
use crate::{
    infrastructure::media::{detect, proxy::MediaProxy},
    infrastructure::network,
    modules::network_settings,
    modules::sources::{self, SourceKind},
};
use playlist::Playlist;
use sqlx::SqlitePool;
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::State;
use tokio::sync::{Mutex, RwLock, Semaphore};

struct Cached {
    fetched: Instant,
    playlist: Playlist,
}
/// 缓存读取独立于下载锁，后台更新期间仍可展示已有频道
#[derive(Default)]
struct CatalogEntry {
    cached: RwLock<Option<Cached>>,
    refresh: Mutex<()>,
}
type Entry = Arc<CatalogEntry>;

impl CatalogEntry {
    /// 普通读取返回任意缓存，强制更新只复用请求开始后取得的结果
    async fn read(&self, force: bool, requested: Instant) -> Option<Playlist> {
        let cached = self.cached.read().await;
        let cached = cached.as_ref()?;
        if force && cached.fetched < requested {
            return None;
        }
        let mut result = cached.playlist.clone();
        result.cached = true;
        result.stale = cached.fetched.elapsed() >= Duration::from_secs(6 * 3600);
        Some(result)
    }
}
pub struct Catalog {
    entries: Mutex<HashMap<String, Entry>>,
    permits: Semaphore,
}
impl Default for Catalog {
    /// 目录缓存与下载限流仅存在于内存
    fn default() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            permits: Semaphore::new(4),
        }
    }
}

impl Catalog {
    /// 普通读取直接返回缓存及过期标记；无缓存或强制更新时下载，同源并发复用成功结果
    async fn get(&self, db: &SqlitePool, source_id: &str, force: bool) -> Result<Playlist, String> {
        let requested = Instant::now();
        let source = sources::find(db, SourceKind::Iptv, source_id).await?;
        if source.disabled {
            return Err("IPTV 源未启用".into());
        }
        let settings = network_settings::read(db).await?;
        let key = serde_json::json!([source.id, source.url, source.headers, settings]).to_string();
        let entry = {
            let mut entries = self.entries.lock().await;
            if entries.len() >= 32 && !entries.contains_key(&key) {
                entries.retain(|_, entry| Arc::strong_count(entry) > 1);
            }
            entries
                .entry(key)
                .or_insert_with(|| Arc::new(CatalogEntry::default()))
                .clone()
        };
        if let Some(result) = entry.read(force, requested).await {
            return Ok(result);
        }
        let _refresh = entry.refresh.lock().await;
        if let Some(result) = entry.read(force, requested).await {
            return Ok(result);
        }
        let playlist = tokio::time::timeout(Duration::from_secs(30), async {
            let _permit = self
                .permits
                .acquire()
                .await
                .map_err(|_| "直播目录服务已停止")?;
            let client = network_settings::client(&settings)?;
            let url = network::parse_http_url(&source.url)?;
            let headers = network::source_headers(&url, &url, &source.headers)?;
            let mut response =
                network::request(&client, reqwest::Method::GET, url, headers).await?;
            if !response.status().is_success() {
                return Err(format!("直播目录返回 HTTP {}", response.status().as_u16()));
            }
            let base = response.url().clone();
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| "读取直播目录失败")?
            {
                if bytes.len() + chunk.len() > 10 * 1024 * 1024 {
                    return Err("直播目录超过 10 MiB 限制".into());
                }
                bytes.extend_from_slice(&chunk);
            }
            let content = String::from_utf8(bytes).map_err(|_| "直播目录不是有效 UTF-8 文本")?;
            let source_id = source.id.clone();
            tauri::async_runtime::spawn_blocking(move || {
                playlist::parse(&content, &source_id, &base)
            })
            .await
            .map_err(|_| "直播目录解析任务失败")?
        })
        .await
        .map_err(|_| "直播目录请求超时".to_owned())
        .and_then(|result| result)?;
        *entry.cached.write().await = Some(Cached {
            fetched: Instant::now(),
            playlist: playlist.clone(),
        });
        Ok(playlist)
    }
}

/// 读取直播目录，缓存不写入数据库
#[tauri::command]
pub async fn get_iptv_catalog(
    db: State<'_, SqlitePool>,
    catalog: State<'_, Catalog>,
    source_id: String,
    force: bool,
) -> Result<Playlist, String> {
    catalog.get(&db, &source_id, force).await
}

/// 合并源和线路请求头，通过已配置的直播路由创建播放会话
#[tauri::command]
pub async fn get_iptv_playback_target(
    db: State<'_, SqlitePool>,
    catalog: State<'_, Catalog>,
    proxy: State<'_, MediaProxy>,
    source_id: String,
    channel_id: String,
    stream_id: String,
) -> Result<serde_json::Value, String> {
    let playlist = catalog.get(&db, &source_id, false).await?;
    let source = sources::find(&db, SourceKind::Iptv, &source_id).await?;
    if source.disabled {
        return Err("IPTV 源未启用".into());
    }
    let channel = playlist
        .channels
        .iter()
        .find(|channel| channel.id == channel_id)
        .ok_or("频道不存在，请刷新直播源")?;
    let stream = channel
        .streams
        .iter()
        .find(|stream| stream.id == stream_id)
        .ok_or("线路不存在，请刷新直播源")?;
    let target = network::parse_http_url(&stream.url)?;
    let mut headers = network::source_headers(
        &network::parse_http_url(&source.url)?,
        &target,
        &source.headers,
    )?;
    headers.extend(network::source_headers(
        &target,
        &target,
        &stream.request_headers.headers,
    )?);
    let settings = network_settings::read(&db).await?;
    let client = network_settings::client(&settings)?;
    let kind = detect::detect(&client, &target, headers.clone()).await?;
    let values = headers
        .iter()
        .map(|(key, value)| {
            Ok((
                key.to_string(),
                value.to_str().map_err(|_| "直播请求头无效")?.to_owned(),
            ))
        })
        .collect::<Result<_, String>>()?;
    let (src, id) = proxy
        .create(
            target,
            kind,
            client,
            network_settings::route_label(&settings),
            values,
        )
        .await?;
    Ok(serde_json::json!({"src":src,"mediaSessionId":id,"streamType":kind}))
}

impl Catalog {
    /// 清除频道目录缓存，进行中的旧请求不会重新插入缓存表
    pub async fn clear(&self) {
        self.entries.lock().await.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 过期缓存直接返回，进行中的更新不阻塞读取，更新失败保留缓存并允许再次更新
    #[tokio::test]
    async fn stale_cache_remains_readable_during_failed_refresh() {
        use axum::{http::StatusCode, routing::get, Router};
        use std::sync::atomic::{AtomicUsize, Ordering};
        let requests = Arc::new(AtomicUsize::new(0));
        let started = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(Semaphore::new(0));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new().route(
            "/list",
            get({
                let requests = requests.clone();
                let started = started.clone();
                let release = release.clone();
                move || {
                    let requests = requests.clone();
                    let started = started.clone();
                    let release = release.clone();
                    async move {
                        if requests.fetch_add(1, Ordering::SeqCst) == 1 {
                            started.notify_one();
                            release.acquire().await.unwrap().forget();
                            (StatusCode::SERVICE_UNAVAILABLE, "暂时不可用")
                        } else {
                            (
                                StatusCode::OK,
                                "新闻,#genre#\n频道,https://stream.test/live.m3u8",
                            )
                        }
                    }
                }
            }),
        );
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        sqlx::query("INSERT INTO sources(id,kind,name,url,sort,created_at,updated_at) VALUES('test','iptv','test',?,0,0,0)")
            .bind(format!("http://{address}/list")).execute(&db).await.unwrap();
        let catalog = Catalog::default();
        catalog.get(&db, "test", false).await.unwrap();
        let entry = catalog
            .entries
            .lock()
            .await
            .values()
            .next()
            .unwrap()
            .clone();
        entry.cached.write().await.as_mut().unwrap().fetched =
            Instant::now() - Duration::from_secs(7 * 3600);

        let stale = catalog.get(&db, "test", false).await.unwrap();
        assert!(stale.cached && stale.stale);
        assert_eq!(requests.load(Ordering::SeqCst), 1);

        let (refresh, read) = tokio::join!(catalog.get(&db, "test", true), async {
            tokio::time::timeout(Duration::from_secs(2), started.notified())
                .await
                .unwrap();
            let read =
                tokio::time::timeout(Duration::from_secs(1), catalog.get(&db, "test", false)).await;
            release.add_permits(1);
            read.expect("缓存读取不应等待更新结束").unwrap()
        });
        assert!(read.cached && read.stale);
        assert_eq!(read.channels.len(), 1);
        assert_eq!(refresh.err().as_deref(), Some("直播目录返回 HTTP 503"));
        let retained = catalog.get(&db, "test", false).await.unwrap();
        assert!(retained.stale);
        assert_eq!(retained.channels.len(), 1);
        assert_eq!(requests.load(Ordering::SeqCst), 2);

        let recovered = catalog.get(&db, "test", true).await.unwrap();
        assert!(!recovered.cached && !recovered.stale);
        assert_eq!(requests.load(Ordering::SeqCst), 3);
        assert!(!catalog.get(&db, "test", false).await.unwrap().stale);
        db.close().await;
        server.abort();
        let _ = server.await;
    }

    /// 同源并发只下载一次，强制刷新和源配置变更均重新请求
    #[tokio::test]
    async fn cache_respects_refresh_and_configuration() {
        use axum::{routing::get, Router};
        use std::sync::atomic::{AtomicUsize, Ordering};
        let requests = Arc::new(AtomicUsize::new(0));
        let counter = requests.clone();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new().route(
                    "/list",
                    get(move || {
                        let counter = counter.clone();
                        async move {
                            counter.fetch_add(1, Ordering::SeqCst);
                            "新闻,#genre#\n频道,https://stream.test/live.m3u8"
                        }
                    }),
                ),
            )
            .await
            .unwrap();
        });
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        sqlx::query("INSERT INTO sources(id,kind,name,url,sort,created_at,updated_at) VALUES('test','iptv','test',?,0,0,0)").bind(format!("http://{address}/list")).execute(&db).await.unwrap();
        let catalog = Catalog::default();
        let (first, second) = tokio::join!(
            catalog.get(&db, "test", false),
            catalog.get(&db, "test", false)
        );
        assert_eq!(first.unwrap().channels.len(), 1);
        assert_eq!(second.unwrap().channels.len(), 1);
        assert_eq!(requests.load(Ordering::SeqCst), 1);
        assert!(catalog.get(&db, "test", false).await.unwrap().cached);
        catalog.get(&db, "test", true).await.unwrap();
        assert_eq!(requests.load(Ordering::SeqCst), 2);
        sqlx::query("UPDATE sources SET headers='{\"X-Source\":\"updated\"}' WHERE id='test'")
            .execute(&db)
            .await
            .unwrap();
        catalog.get(&db, "test", false).await.unwrap();
        assert_eq!(requests.load(Ordering::SeqCst), 3);
        catalog.clear().await;
        catalog.get(&db, "test", false).await.unwrap();
        assert_eq!(requests.load(Ordering::SeqCst), 4);
        sqlx::query("UPDATE sources SET disabled=1 WHERE id='test'")
            .execute(&db)
            .await
            .unwrap();
        assert!(catalog.get(&db, "test", false).await.is_err());
        db.close().await;
        server.abort();
        let _ = server.await;
    }
}
