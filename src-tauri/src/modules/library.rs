use super::vod::recent_updates::{read_info, RecentUpdateInfo, RecentUpdates};
use crate::infrastructure::diagnostics::command_error;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use tauri::State;

#[derive(Deserialize, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RecentPlay {
    source_id: String,
    source_name: String,
    vod_id: String,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    poster: Option<String>,
    line_name: String,
    episode_name: String,
    episode_url: String,
    position_seconds: f64,
    duration: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    raw_json: Option<String>,
    played_at: i64,
    #[sqlx(skip)]
    #[serde(skip_deserializing, skip_serializing_if = "Option::is_none")]
    update_info: Option<RecentUpdateInfo>,
}

#[derive(Deserialize, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    source_id: String,
    source_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_url: Option<String>,
    vod_id: String,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    poster: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    year: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    area: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    remarks: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    actor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    director: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    raw_json: Option<String>,
    #[serde(default)]
    created_at: i64,
    #[serde(default)]
    updated_at: i64,
}

/// 按播放时间读取最近记录
#[tauri::command]
pub async fn list_recent_plays(
    db: State<'_, SqlitePool>,
    limit: Option<u32>,
) -> Result<Vec<RecentPlay>, String> {
    let mut items: Vec<RecentPlay> = sqlx::query_as(
        "SELECT * FROM recent_plays ORDER BY played_at DESC,source_id,vod_id LIMIT ?",
    )
    .bind(i64::from(limit.unwrap_or(20).min(10000)))
    .fetch_all(db.inner())
    .await
    .map_err(|error| command_error("读取播放记录失败", &error))?;
    for item in &mut items {
        item.update_info = read_info(&db, &item.source_id, &item.vod_id).await?;
    }
    Ok(items)
}

/// 按源与视频标识读取播放进度，不受最近列表条数限制
#[tauri::command]
pub async fn get_recent_play(
    db: State<'_, SqlitePool>,
    source_id: String,
    vod_id: String,
) -> Result<Option<RecentPlay>, String> {
    let mut item: Option<RecentPlay> =
        sqlx::query_as("SELECT * FROM recent_plays WHERE source_id=? AND vod_id=?")
            .bind(source_id)
            .bind(vod_id)
            .fetch_optional(db.inner())
            .await
            .map_err(|error| command_error("读取播放进度失败", &error))?;
    if let Some(item) = &mut item {
        item.update_info = read_info(&db, &item.source_id, &item.vod_id).await?;
    }
    Ok(item)
}

/// 按源与视频标识覆盖播放进度，同名作品独立保存
async fn save_recent(db: &SqlitePool, input: RecentPlay) -> Result<RecentPlay, String> {
    if input.title.trim().is_empty()
        || input.source_id.trim().is_empty()
        || input.vod_id.trim().is_empty()
        || !input.position_seconds.is_finite()
        || !input.duration.is_finite()
        || input.position_seconds < 0.0
        || input.duration < 0.0
        || input.played_at < 0
        || input
            .raw_json
            .as_deref()
            .is_some_and(|raw| serde_json::from_str::<serde_json::Value>(raw).is_err())
    {
        return Err("播放记录格式无效".to_owned());
    }
    sqlx::query_as("INSERT INTO recent_plays(source_id,source_name,vod_id,title,poster,line_name,episode_name,episode_url,position_seconds,duration,raw_json,played_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id,vod_id) DO UPDATE SET source_name=excluded.source_name,title=excluded.title,poster=excluded.poster,line_name=excluded.line_name,episode_name=excluded.episode_name,episode_url=excluded.episode_url,position_seconds=excluded.position_seconds,duration=excluded.duration,raw_json=excluded.raw_json,played_at=excluded.played_at RETURNING *")
        .bind(&input.source_id).bind(&input.source_name).bind(&input.vod_id).bind(&input.title).bind(&input.poster).bind(&input.line_name).bind(&input.episode_name).bind(&input.episode_url).bind(input.position_seconds).bind(input.duration).bind(&input.raw_json).bind(input.played_at)
        .fetch_one(db).await.map_err(|error| command_error("保存播放记录失败", &error))
}

/// 保存最近播放进度
#[tauri::command]
pub async fn upsert_recent_play(
    db: State<'_, SqlitePool>,
    input: RecentPlay,
) -> Result<RecentPlay, String> {
    save_recent(&db, input).await
}

/// 仅删除指定源中的视频播放记录
#[tauri::command]
pub async fn remove_recent_play(
    db: State<'_, SqlitePool>,
    updates: State<'_, std::sync::Arc<RecentUpdates>>,
    source_id: String,
    vod_id: String,
) -> Result<(), String> {
    let _guard = updates.invalidate().await;
    sqlx::query("DELETE FROM recent_plays WHERE source_id=? AND vod_id=?")
        .bind(source_id)
        .bind(vod_id)
        .execute(db.inner())
        .await
        .map_err(|error| command_error("删除播放记录失败", &error))?;
    Ok(())
}

/// 读取收藏列表
#[tauri::command]
pub async fn list_favorites(db: State<'_, SqlitePool>) -> Result<Vec<Favorite>, String> {
    sqlx::query_as("SELECT * FROM favorites ORDER BY updated_at DESC,source_id,vod_id")
        .fetch_all(db.inner())
        .await
        .map_err(|error| command_error("读取收藏失败", &error))
}

/// 按源与视频标识判断收藏状态
#[tauri::command]
pub async fn is_favorite(
    db: State<'_, SqlitePool>,
    source_id: String,
    vod_id: String,
) -> Result<bool, String> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM favorites WHERE source_id=? AND vod_id=?)")
        .bind(source_id)
        .bind(vod_id)
        .fetch_one(db.inner())
        .await
        .map_err(|error| command_error("读取收藏状态失败", &error))
}

/// 更新收藏内容，保留业务唯一键和最初收藏时间
async fn save_favorite(db: &SqlitePool, input: Favorite) -> Result<Favorite, String> {
    if input.source_id.trim().is_empty()
        || input.vod_id.trim().is_empty()
        || input.title.trim().is_empty()
        || input
            .raw_json
            .as_deref()
            .is_some_and(|raw| serde_json::from_str::<serde_json::Value>(raw).is_err())
    {
        return Err("收藏数据格式无效".to_owned());
    }
    sqlx::query_as("INSERT INTO favorites(source_id,vod_id,source_name,source_url,title,poster,year,area,language,category,remarks,actor,director,description,raw_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER),CAST(unixepoch('subsec')*1000 AS INTEGER)) ON CONFLICT(source_id,vod_id) DO UPDATE SET source_name=excluded.source_name,source_url=excluded.source_url,title=excluded.title,poster=excluded.poster,year=excluded.year,area=excluded.area,language=excluded.language,category=excluded.category,remarks=excluded.remarks,actor=excluded.actor,director=excluded.director,description=excluded.description,raw_json=excluded.raw_json,updated_at=excluded.updated_at RETURNING *")
        .bind(input.source_id).bind(input.vod_id).bind(input.source_name).bind(input.source_url).bind(input.title).bind(input.poster).bind(input.year).bind(input.area).bind(input.language).bind(input.category).bind(input.remarks).bind(input.actor).bind(input.director).bind(input.description).bind(input.raw_json)
        .fetch_one(db).await.map_err(|error| command_error("保存收藏失败", &error))
}

/// 新增或更新收藏条目
#[tauri::command]
pub async fn add_favorite(db: State<'_, SqlitePool>, input: Favorite) -> Result<Favorite, String> {
    save_favorite(&db, input).await
}

/// 删除指定源中的收藏条目
#[tauri::command]
pub async fn remove_favorite(
    db: State<'_, SqlitePool>,
    source_id: String,
    vod_id: String,
) -> Result<(), String> {
    sqlx::query("DELETE FROM favorites WHERE source_id=? AND vod_id=?")
        .bind(source_id)
        .bind(vod_id)
        .execute(db.inner())
        .await
        .map_err(|error| command_error("删除收藏失败", &error))?;
    Ok(())
}
