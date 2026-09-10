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
    sqlx::query_as("SELECT * FROM recent_plays ORDER BY played_at DESC,source_id,vod_id LIMIT ?")
        .bind(i64::from(limit.unwrap_or(20).min(10000)))
        .fetch_all(db.inner())
        .await
        .map_err(|error| command_error("读取播放记录失败", &error))
}

/// 按源与视频标识读取播放进度，不受最近列表条数限制
#[tauri::command]
pub async fn get_recent_play(
    db: State<'_, SqlitePool>,
    source_id: String,
    vod_id: String,
) -> Result<Option<RecentPlay>, String> {
    sqlx::query_as("SELECT * FROM recent_plays WHERE source_id=? AND vod_id=?")
        .bind(source_id)
        .bind(vod_id)
        .fetch_optional(db.inner())
        .await
        .map_err(|error| command_error("读取播放进度失败", &error))
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
    source_id: String,
    vod_id: String,
) -> Result<(), String> {
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

#[cfg(test)]
mod tests {
    use super::*;
    /// 同名不同源和同源不同视频互不覆盖，同一视频改名后仍更新原记录
    #[tokio::test]
    async fn recent_identity_preserves_distinct_videos_and_progress() {
        use tauri::Manager;
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        let mut payload = serde_json::json!({"sourceId":"a","sourceName":"A","vodId":"1","title":" My Show ","lineName":"main","episodeName":"1","episodeUrl":"https://a.test/1.mp4","positionSeconds":12,"duration":100,"playedAt":1000});
        let first = save_recent(&db, serde_json::from_value(payload.clone()).unwrap())
            .await
            .unwrap();
        assert_eq!(first.source_id, "a");
        payload["sourceId"] = "b".into();
        payload["title"] = "myshow".into();
        save_recent(&db, serde_json::from_value(payload.clone()).unwrap())
            .await
            .unwrap();
        payload["vodId"] = "2".into();
        save_recent(&db, serde_json::from_value(payload.clone()).unwrap())
            .await
            .unwrap();
        payload["vodId"] = "1".into();
        payload["title"] = "Renamed".into();
        payload["positionSeconds"] = 30.into();
        save_recent(&db, serde_json::from_value(payload.clone()).unwrap())
            .await
            .unwrap();
        payload["positionSeconds"] = (-1).into();
        assert!(save_recent(&db, serde_json::from_value(payload).unwrap())
            .await
            .is_err());
        let rows: Vec<RecentPlay> = sqlx::query_as("SELECT * FROM recent_plays")
            .fetch_all(&db)
            .await
            .unwrap();
        assert_eq!(rows.len(), 3);
        let app = tauri::test::mock_builder()
            .manage(db.clone())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let saved = get_recent_play(app.state(), "b".into(), "1".into())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(saved.title, "Renamed");
        assert_eq!(saved.position_seconds, 30.0);
        remove_recent_play(app.state(), "b".into(), "1".into())
            .await
            .unwrap();
        assert!(get_recent_play(app.state(), "b".into(), "1".into())
            .await
            .unwrap()
            .is_none());
        assert!(get_recent_play(app.state(), "a".into(), "1".into())
            .await
            .unwrap()
            .is_some());
        assert!(get_recent_play(app.state(), "b".into(), "2".into())
            .await
            .unwrap()
            .is_some());
        db.close().await;
    }

    /// 数据库层面同样拒绝负进度，不依赖 Rust 校验兜底
    #[tokio::test]
    async fn database_rejects_negative_position() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        let error = sqlx::query("INSERT INTO recent_plays(source_id,source_name,vod_id,title,line_name,episode_name,episode_url,position_seconds,duration,played_at) VALUES('s','S','v','T','l','e','u',-1,10,1)")
            .execute(&db)
            .await
            .unwrap_err();
        assert!(error.as_database_error().unwrap().is_check_violation());
        db.close().await;
    }

    /// 同一视频重复收藏保留首次标识和创建时间
    #[tokio::test]
    async fn repeated_favorite_preserves_identity() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        let mut payload = serde_json::json!({"sourceId":"source","sourceName":"Source","vodId":"video","title":"Title"});
        let first = save_favorite(&db, serde_json::from_value(payload.clone()).unwrap())
            .await
            .unwrap();
        payload["title"] = "Updated".into();
        let second = save_favorite(&db, serde_json::from_value(payload).unwrap())
            .await
            .unwrap();
        assert_eq!(first.source_id, second.source_id);
        assert_eq!(first.vod_id, second.vod_id);
        assert_eq!(first.created_at, second.created_at);
        assert_eq!(second.title, "Updated");
        db.close().await;
    }
}
