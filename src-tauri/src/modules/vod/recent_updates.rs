use super::{api, enabled};
use crate::{infrastructure::network, modules::sources::Source};
use futures_util::{future::BoxFuture, stream, FutureExt, StreamExt};
use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, SqlitePool};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, State};
use tokio::sync::{Mutex, MutexGuard, Semaphore};

/// 成功检查结果的自动复用时间。
const CHECK_INTERVAL_MS: i64 = 10 * 60 * 1000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentUpdateInfo {
    pub latest_detail: Value,
    pub checked_at: i64,
    pub episode_count: usize,
    pub pending_episode_count: usize,
    pub new_episode_keys: Vec<String>,
    pub revision: String,
    pub remarks: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailRefresh {
    detail: Value,
    update_info: Option<RecentUpdateInfo>,
}

#[derive(FromRow)]
struct SavedUpdate {
    latest_detail: String,
    checked_at: i64,
    max_episode_count: i64,
    pending_episode_count: i64,
    known_episode_keys: String,
    pending_episode_keys: String,
    revision: String,
    source_config: String,
}

impl SavedUpdate {
    /// 读取已检查的详情及可展示更新信息。
    fn result(&self) -> Result<DetailRefresh, String> {
        let detail: Value =
            serde_json::from_str(&self.latest_detail).map_err(|_| "剧集更新数据无效")?;
        Ok(DetailRefresh {
            update_info: Some(RecentUpdateInfo {
                latest_detail: detail.clone(),
                checked_at: self.checked_at,
                episode_count: episode_count(&detail["raw"]).unwrap_or(0),
                pending_episode_count: self.pending_episode_count as usize,
                new_episode_keys: serde_json::from_str(&self.pending_episode_keys)
                    .map_err(|_| "新增剧集数据无效")?,
                revision: self.revision.clone(),
                remarks: detail["remarks"].as_str().map(String::from),
            }),
            detail,
        })
    }
}

type RefreshFuture =
    futures_util::future::Shared<BoxFuture<'static, Result<DetailRefresh, String>>>;

#[derive(Default)]
pub(crate) struct Registry {
    generation: u64,
    tasks: HashMap<(String, String), (String, RefreshFuture)>,
}

/// 在全部窗口间复用详情请求，限制并发并隔离删除与导入后的旧结果。
pub struct RecentUpdates {
    registry: Mutex<Registry>,
    permits: Semaphore,
}

impl Default for RecentUpdates {
    /// 建立最多四个并发请求的更新检查服务。
    fn default() -> Self {
        Self {
            registry: Mutex::new(Registry::default()),
            permits: Semaphore::new(4),
        }
    }
}

impl RecentUpdates {
    /// 使旧任务失效，并在数据删除或恢复期间阻止结果写入。
    pub(crate) async fn invalidate(&self) -> MutexGuard<'_, Registry> {
        let mut registry = self.registry.lock().await;
        registry.generation += 1;
        registry.tasks.clear();
        registry
    }

    /// 复用正在执行的请求，或在自动检查期限内返回已保存的结果。
    async fn refresh(
        self: &Arc<Self>,
        db: &SqlitePool,
        source_id: String,
        vod_id: String,
        force: bool,
        expected_generation: Option<u64>,
    ) -> Result<DetailRefresh, String> {
        if source_id.trim().is_empty() || vod_id.trim().is_empty() {
            return Err("视频标识不能为空".into());
        }
        let mut registry = self.registry.lock().await;
        if expected_generation.is_some_and(|generation| generation != registry.generation) {
            return Err("数据已变化，请重新检查".into());
        }
        let key = (source_id.clone(), vod_id.clone());
        if let Some((_, task)) = registry.tasks.get(&key) {
            let task = task.clone();
            drop(registry);
            return task.await;
        }
        let source = enabled(db, &source_id).await?;
        let config = source_config(&source);
        let saved = read_saved(db, &source_id, &vod_id).await?;
        if let Some(saved) = &saved {
            let elapsed = now() - saved.checked_at;
            if !force && (0..CHECK_INTERVAL_MS).contains(&elapsed) && saved.source_config == config
            {
                return saved.result();
            }
        }
        let recent: Option<(Option<String>,)> =
            sqlx::query_as("SELECT raw_json FROM recent_plays WHERE source_id=? AND vod_id=?")
                .bind(&source_id)
                .bind(&vod_id)
                .fetch_optional(db)
                .await
                .map_err(|e| format!("读取更新基准失败: {e}"))?;
        let baseline = recent
            .as_ref()
            .and_then(|(raw,)| raw.as_deref())
            .and_then(|raw| serde_json::from_str::<Value>(raw).ok());
        let generation = registry.generation;
        let task_id = uuid::Uuid::new_v4().to_string();
        let cleanup_id = task_id.clone();
        let cleanup_key = key.clone();
        let service = self.clone();
        let pool = db.clone();
        let task = async move {
            let result = service
                .fetch(
                    &pool,
                    &source,
                    &vod_id,
                    baseline,
                    recent.is_some(),
                    generation,
                )
                .await;
            let mut registry = service.registry.lock().await;
            if registry
                .tasks
                .get(&cleanup_key)
                .is_some_and(|(id, _)| id == &cleanup_id)
            {
                registry.tasks.remove(&cleanup_key);
            }
            result
        }
        .boxed()
        .shared();
        registry.tasks.insert(key, (task_id, task.clone()));
        drop(registry);
        task.await
    }

    /// 请求原源详情，在结果仍属于当前数据时独立保存检查状态。
    async fn fetch(
        &self,
        db: &SqlitePool,
        source: &Source,
        vod_id: &str,
        baseline: Option<Value>,
        had_recent: bool,
        generation: u64,
    ) -> Result<DetailRefresh, String> {
        let _permit = self.permits.acquire().await.map_err(|_| "更新检查已停止")?;
        if self.registry.lock().await.generation != generation {
            return Err("数据已变化，请重新检查".into());
        }
        let client = network::create_client(&network::NetworkMode::Direct)?;
        let detail = api::details(&client, source, &[vod_id.into()])
            .await?
            .into_iter()
            .find(|item| item["vodId"] == vod_id)
            .ok_or("未找到该视频详情")?;
        episode_count(&detail["raw"]).ok_or("源站未返回有效选集，保留原有详情")?;
        let registry = self.registry.lock().await;
        if registry.generation != generation {
            return Err("数据已变化，请重新检查".into());
        }
        let current_source = enabled(db, &source.id).await?;
        if source_config(&current_source) != source_config(source) {
            return Err("数据源已变化，请重新检查".into());
        }
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM recent_plays WHERE source_id=? AND vod_id=?)",
        )
        .bind(&source.id)
        .bind(vod_id)
        .fetch_one(db)
        .await
        .map_err(|e| format!("读取播放记录失败: {e}"))?;
        if !had_recent || !exists {
            return Ok(DetailRefresh {
                detail,
                update_info: None,
            });
        }
        save_detail(
            db,
            &source.id,
            vod_id,
            &detail,
            baseline.as_ref(),
            &source_config(source),
        )
        .await
    }
}

/// 根据已有检查基准累计新增数量，保留已确认状态与历史最大集数。
async fn save_detail(
    db: &SqlitePool,
    source_id: &str,
    vod_id: &str,
    detail: &Value,
    baseline: Option<&Value>,
    config: &str,
) -> Result<DetailRefresh, String> {
    let saved = read_saved(db, source_id, vod_id).await?;
    let count = episode_count(&detail["raw"]).ok_or("详情没有可播放剧集")?;
    let previous_max = saved
        .as_ref()
        .map(|saved| saved.max_episode_count as usize)
        .or_else(|| baseline.and_then(episode_count))
        .unwrap_or(count);
    let growth = count.saturating_sub(previous_max);
    let pending = saved
        .as_ref()
        .map_or(0, |saved| saved.pending_episode_count as usize)
        + growth;
    let mut known: HashSet<String> = saved
        .as_ref()
        .map(|saved| serde_json::from_str(&saved.known_episode_keys))
        .transpose()
        .map_err(|_| "剧集检查基准无效")?
        .unwrap_or_else(|| {
            baseline
                .map(episode_keys)
                .unwrap_or_default()
                .into_iter()
                .flatten()
                .collect()
        });
    let mut new_keys: HashSet<String> = saved
        .as_ref()
        .map(|saved| serde_json::from_str(&saved.pending_episode_keys))
        .transpose()
        .map_err(|_| "新增剧集数据无效")?
        .unwrap_or_default();
    let lines = episode_keys(&detail["raw"]);
    if growth > 0 {
        for line in &lines {
            // 多线路的同集共用名称键，地址变化和列表重排不会改变已记录标记。
            new_keys.extend(
                line.iter()
                    .filter(|key| !known.contains(*key))
                    .rev()
                    .take(growth)
                    .cloned(),
            );
        }
    }
    known.extend(lines.into_iter().flatten());
    let mut known: Vec<_> = known.into_iter().collect();
    let mut new_keys: Vec<_> = new_keys.into_iter().collect();
    known.sort();
    new_keys.sort();
    let checked_at = now();
    let revision = uuid::Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO recent_updates(source_id,vod_id,latest_detail,checked_at,max_episode_count,pending_episode_count,known_episode_keys,pending_episode_keys,revision,source_config) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id,vod_id) DO UPDATE SET latest_detail=excluded.latest_detail,checked_at=excluded.checked_at,max_episode_count=excluded.max_episode_count,pending_episode_count=excluded.pending_episode_count,known_episode_keys=excluded.known_episode_keys,pending_episode_keys=excluded.pending_episode_keys,revision=excluded.revision,source_config=excluded.source_config")
        .bind(source_id).bind(vod_id).bind(detail.to_string()).bind(checked_at).bind(count.max(previous_max) as i64).bind(pending as i64).bind(serde_json::to_string(&known).map_err(|_| "剧集检查基准无效")?).bind(serde_json::to_string(&new_keys).map_err(|_| "新增剧集数据无效")?).bind(&revision).bind(config)
        .execute(db).await.map_err(|e| format!("保存剧集更新失败: {e}"))?;
    Ok(DetailRefresh {
        detail: detail.clone(),
        update_info: Some(RecentUpdateInfo {
            latest_detail: detail.clone(),
            checked_at,
            episode_count: count,
            pending_episode_count: pending,
            new_episode_keys: new_keys,
            revision,
            remarks: detail["remarks"].as_str().map(String::from),
        }),
    })
}

/// 获取毫秒时间，避免时钟错误产生负时间。
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

/// 使用会影响详情请求的源配置区分检查缓存。
fn source_config(source: &Source) -> String {
    serde_json::json!([source.url, source.headers, source.name]).to_string()
}

/// 按 CMS 编码统计单条线路最大有效集数，同一线路的重复项只计一次。
fn episode_count(raw: &Value) -> Option<usize> {
    let maximum = episode_keys(raw).iter().map(Vec::len).max().unwrap_or(0);
    (maximum > 0).then_some(maximum)
}

/// 提取各线路有效剧集的稳定名称键，忽略重复项和地址变化。
fn episode_keys(raw: &Value) -> Vec<Vec<String>> {
    let Some(play_url) = raw["vod_play_url"].as_str() else {
        return Vec::new();
    };
    play_url
        .split("$$$")
        .map(|line| {
            let mut seen = HashSet::new();
            let mut episodes = Vec::new();
            for (index, entry) in line.split('#').enumerate() {
                let (name, url) = entry
                    .split_once('$')
                    .map_or((None, entry), |(name, url)| (Some(name), url));
                if reqwest::Url::parse(url.trim())
                    .is_ok_and(|url| matches!(url.scheme(), "http" | "https"))
                {
                    let key = name
                        .map(str::trim)
                        .filter(|name| !name.is_empty())
                        .map(String::from)
                        .unwrap_or_else(|| format!("第{}集", index + 1));
                    let key = episode_key(&key);
                    if seen.insert(key.clone()) {
                        episodes.push(key);
                    }
                }
            }
            episodes
        })
        .collect()
}

/// 统一常见数字集名及非数字名称，供跨线路的新增标记定位。
fn episode_key(name: &str) -> String {
    static NUMBER: OnceLock<regex::Regex> = OnceLock::new();
    let number = NUMBER.get_or_init(|| {
        regex::Regex::new(r"(?i)^(?:第|ep(?:isode)?)?0*(\d+)(?:集|期|话)?$")
            .expect("固定剧集名称表达式有效")
    });
    let name = name
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>()
        .to_lowercase();
    if let Some(value) = number
        .captures(&name)
        .and_then(|captures| captures[1].parse::<u64>().ok())
    {
        format!("episode:{value}")
    } else {
        format!("name:{name}")
    }
}

/// 按源和视频读取检查状态，观看进度不参与查询。
async fn read_saved(
    db: &SqlitePool,
    source_id: &str,
    vod_id: &str,
) -> Result<Option<SavedUpdate>, String> {
    sqlx::query_as("SELECT * FROM recent_updates WHERE source_id=? AND vod_id=?")
        .bind(source_id)
        .bind(vod_id)
        .fetch_optional(db)
        .await
        .map_err(|e| format!("读取更新状态失败: {e}"))
}

/// 将已保存的检查信息附加到最近播放返回值。
pub(crate) async fn read_info(
    db: &SqlitePool,
    source_id: &str,
    vod_id: &str,
) -> Result<Option<RecentUpdateInfo>, String> {
    read_saved(db, source_id, vod_id)
        .await?
        .map(|saved| saved.result().map(|result| result.update_info))
        .transpose()
        .map(Option::flatten)
}

/// 通知窗口重新读取最近播放，但不触发新的联网检查。
fn notify(app: &tauri::AppHandle) {
    if let Err(error) = app.emit("recent-updates-changed", ()) {
        log::warn!("剧集更新通知失败: {error}");
    }
}

/// 强制刷新当前视频详情，已存在的观看记录同步获得更新检查结果。
#[tauri::command]
pub async fn refresh_recent_vod_detail(
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
    updates: State<'_, Arc<RecentUpdates>>,
    source_id: String,
    vod_id: String,
) -> Result<DetailRefresh, String> {
    let result = updates.refresh(&db, source_id, vod_id, true, None).await?;
    if result.update_info.is_some() {
        notify(&app);
    }
    Ok(result)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    source_id: String,
    vod_id: String,
    error: Option<String>,
}

/// 检查当前最近列表，逐项通知成功结果并保留各条目失败信息。
#[tauri::command]
pub async fn check_recent_updates(
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
    updates: State<'_, Arc<RecentUpdates>>,
    limit: Option<u32>,
    force: bool,
) -> Result<Vec<CheckResult>, String> {
    let registry = updates.registry.lock().await;
    let generation = registry.generation;
    let keys: Vec<(String, String)> = sqlx::query_as("SELECT source_id,vod_id FROM recent_plays ORDER BY played_at DESC,source_id,vod_id LIMIT ?")
        .bind(i64::from(limit.unwrap_or(20).min(10000))).fetch_all(db.inner()).await.map_err(|e| format!("读取检查列表失败: {e}"))?;
    drop(registry);
    Ok(stream::iter(keys)
        .map(|(source_id, vod_id)| async {
            let result = updates
                .refresh(
                    &db,
                    source_id.clone(),
                    vod_id.clone(),
                    force,
                    Some(generation),
                )
                .await;
            if result.is_ok() {
                notify(&app);
            }
            CheckResult {
                source_id,
                vod_id,
                error: result.err(),
            }
        })
        .buffer_unordered(4)
        .collect()
        .await)
}

/// 仅确认已展示版本，避免较晚到达的确认清除下一次新增提醒。
#[tauri::command]
pub async fn acknowledge_recent_update(
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
    updates: State<'_, Arc<RecentUpdates>>,
    source_id: String,
    vod_id: String,
    revision: String,
) -> Result<(), String> {
    let _guard = updates.registry.lock().await;
    acknowledge(&db, &source_id, &vod_id, &revision).await?;
    notify(&app);
    Ok(())
}

/// 原子清除对应版本的待确认数量。
async fn acknowledge(
    db: &SqlitePool,
    source_id: &str,
    vod_id: &str,
    revision: &str,
) -> Result<(), String> {
    sqlx::query("UPDATE recent_updates SET pending_episode_count=0,pending_episode_keys='[]' WHERE source_id=? AND vod_id=? AND revision=?")
        .bind(source_id).bind(vod_id).bind(revision).execute(db).await.map_err(|e| format!("确认剧集更新失败: {e}"))?;
    Ok(())
}
