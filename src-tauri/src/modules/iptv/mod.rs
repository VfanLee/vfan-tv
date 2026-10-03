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
