use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use tauri::State;

#[derive(Deserialize, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RecentPlay {
    id: String,
    source_id: String,
    source_name: String,
    vod_id: String,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    poster: Option<String>,
    line_name: String,
    episode_name: String,
    episode_url: String,
    current_time: f64,
    duration: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    raw_json: Option<String>,
    played_at: i64,
}

#[derive(Deserialize, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    id: String,
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

/// 规范化标题作为跨源最近播放的唯一键
fn title_key(title: &str) -> String {
    title
        .chars()
        .filter(|character| !character.is_whitespace())
        .flat_map(char::to_lowercase)
        .collect()
}

/// 按播放时间读取最近记录
#[tauri::command]
pub async fn list_recent_plays(
    db: State<'_, SqlitePool>,
    limit: Option<u32>,
) -> Result<Vec<RecentPlay>, String> {
    sqlx::query_as("SELECT * FROM recent_plays ORDER BY played_at DESC,id LIMIT ?")
        .bind(i64::from(limit.unwrap_or(20).min(10000)))
        .fetch_all(db.inner())
        .await
        .map_err(|_| "读取播放记录失败".to_owned())
}

/// 原子替换同标题的进度，失败时保留旧记录
async fn save_recent(db: &SqlitePool, input: RecentPlay) -> Result<RecentPlay, String> {
    let key = title_key(&input.title);
    if key.is_empty()
        || input.id.trim().is_empty()
        || input.source_id.trim().is_empty()
        || input.vod_id.trim().is_empty()
        || !input.current_time.is_finite()
        || !input.duration.is_finite()
        || input.current_time < 0.0
        || input.duration < 0.0
        || input.played_at < 0
    {
        return Err("播放记录格式无效".to_owned());
    }
    let mut tx = db.begin().await.map_err(|_| "无法保存播放记录")?;
    sqlx::query("DELETE FROM recent_plays WHERE title_key=? AND id<>?")
        .bind(&key)
        .bind(&input.id)
        .execute(&mut *tx)
        .await
        .map_err(|_| "更新播放记录失败")?;
    sqlx::query("INSERT INTO recent_plays(id,source_id,source_name,vod_id,title,title_key,poster,line_name,episode_name,episode_url,current_time,duration,raw_json,played_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_id=excluded.source_id,source_name=excluded.source_name,vod_id=excluded.vod_id,title=excluded.title,title_key=excluded.title_key,poster=excluded.poster,line_name=excluded.line_name,episode_name=excluded.episode_name,episode_url=excluded.episode_url,current_time=excluded.current_time,duration=excluded.duration,raw_json=excluded.raw_json,played_at=excluded.played_at")
        .bind(&input.id).bind(&input.source_id).bind(&input.source_name).bind(&input.vod_id).bind(&input.title).bind(key).bind(&input.poster).bind(&input.line_name).bind(&input.episode_name).bind(&input.episode_url).bind(input.current_time).bind(input.duration).bind(&input.raw_json).bind(input.played_at)
        .execute(&mut *tx).await.map_err(|_| "保存播放记录失败")?;
    tx.commit().await.map_err(|_| "提交播放记录失败")?;
    Ok(input)
}

/// 保存最近播放进度
#[tauri::command]
pub async fn upsert_recent_play(
    db: State<'_, SqlitePool>,
    input: RecentPlay,
) -> Result<RecentPlay, String> {
    save_recent(&db, input).await
}

/// 按规范化标题删除播放记录
#[tauri::command]
pub async fn remove_recent_play(db: State<'_, SqlitePool>, title: String) -> Result<(), String> {
    sqlx::query("DELETE FROM recent_plays WHERE title_key=?")
        .bind(title_key(&title))
        .execute(db.inner())
        .await
        .map_err(|_| "删除播放记录失败")?;
    Ok(())
}

/// 读取收藏列表
#[tauri::command]
pub async fn list_favorites(db: State<'_, SqlitePool>) -> Result<Vec<Favorite>, String> {
    sqlx::query_as("SELECT * FROM favorites ORDER BY updated_at DESC,id")
        .fetch_all(db.inner())
        .await
        .map_err(|_| "读取收藏失败".to_owned())
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
        .map_err(|_| "读取收藏状态失败".to_owned())
}

/// 更新收藏内容，保留业务唯一键和最初收藏时间
async fn save_favorite(db: &SqlitePool, input: Favorite) -> Result<Favorite, String> {
    if input.id.trim().is_empty()
        || input.source_id.trim().is_empty()
        || input.vod_id.trim().is_empty()
        || input.title.trim().is_empty()
    {
        return Err("收藏数据格式无效".to_owned());
    }
    sqlx::query_as("INSERT INTO favorites(id,source_id,source_name,source_url,vod_id,title,poster,year,area,language,category,remarks,actor,director,description,raw_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER),CAST(unixepoch('subsec')*1000 AS INTEGER)) ON CONFLICT(source_id,vod_id) DO UPDATE SET source_name=excluded.source_name,source_url=excluded.source_url,title=excluded.title,poster=excluded.poster,year=excluded.year,area=excluded.area,language=excluded.language,category=excluded.category,remarks=excluded.remarks,actor=excluded.actor,director=excluded.director,description=excluded.description,raw_json=excluded.raw_json,updated_at=excluded.updated_at RETURNING *")
        .bind(input.id).bind(input.source_id).bind(input.source_name).bind(input.source_url).bind(input.vod_id).bind(input.title).bind(input.poster).bind(input.year).bind(input.area).bind(input.language).bind(input.category).bind(input.remarks).bind(input.actor).bind(input.director).bind(input.description).bind(input.raw_json)
        .fetch_one(db).await.map_err(|_| "保存收藏失败".to_owned())
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
        .map_err(|_| "删除收藏失败")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    /// 同标题跨源续播只保留最新记录，非法进度不能覆盖已有数据
    #[tokio::test]
    async fn recent_titles_merge_and_invalid_progress_is_rejected() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        let mut payload = serde_json::json!({"id":"first","sourceId":"a","sourceName":"A","vodId":"1","title":" My Show ","lineName":"main","episodeName":"1","episodeUrl":"https://a.test/1.mp4","currentTime":12,"duration":100,"playedAt":1000});
        save_recent(&db, serde_json::from_value(payload.clone()).unwrap())
            .await
            .unwrap();
        payload["id"] = "second".into();
        payload["sourceId"] = "b".into();
        payload["title"] = "myshow".into();
        save_recent(&db, serde_json::from_value(payload.clone()).unwrap())
            .await
            .unwrap();
        payload["currentTime"] = (-1).into();
        assert!(save_recent(&db, serde_json::from_value(payload).unwrap())
            .await
            .is_err());
        let rows: Vec<RecentPlay> = sqlx::query_as("SELECT * FROM recent_plays")
            .fetch_all(&db)
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].source_id, "b");
        assert_eq!(rows[0].current_time, 12.0);
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
        let mut payload = serde_json::json!({"id":"first","sourceId":"source","sourceName":"Source","vodId":"video","title":"Title"});
        let first = save_favorite(&db, serde_json::from_value(payload.clone()).unwrap())
            .await
            .unwrap();
        payload["id"] = "second".into();
        payload["title"] = "Updated".into();
        let second = save_favorite(&db, serde_json::from_value(payload).unwrap())
            .await
            .unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(first.created_at, second.created_at);
        assert_eq!(second.title, "Updated");
        db.close().await;
    }
}
