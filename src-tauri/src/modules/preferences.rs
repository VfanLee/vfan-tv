use serde::Serialize;
use serde_json::Value;
use sqlx::{FromRow, SqlitePool};
use tauri::{Emitter, State};

#[derive(Serialize)]
pub struct Preference {
    key: String,
    value: Value,
}

#[derive(FromRow)]
struct PreferenceRow {
    key: String,
    value: String,
}

/// 读取指定界面域的持久化偏好
#[tauri::command]
pub async fn list_ui_preferences(
    db: State<'_, SqlitePool>,
    scope: String,
) -> Result<Vec<Preference>, String> {
    let rows = sqlx::query_as::<_, PreferenceRow>(
        "SELECT key, value FROM ui_preferences WHERE scope = ? ORDER BY key",
    )
    .bind(scope)
    .fetch_all(db.inner())
    .await
    .map_err(|_| "读取偏好失败".to_owned())?;
    rows.into_iter()
        .map(|row| {
            let value = serde_json::from_str(&row.value).map_err(|_| "偏好数据损坏".to_owned())?;
            Ok(Preference {
                key: row.key,
                value,
            })
        })
        .collect()
}

/// 校验并保存界面偏好，提交后通知其他窗口刷新
#[tauri::command]
pub async fn set_ui_preference(
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
    scope: String,
    key: String,
    value: Value,
) -> Result<(), String> {
    if scope.trim().is_empty()
        || scope.chars().count() > 64
        || key.trim().is_empty()
        || key.chars().count() > 128
    {
        return Err("偏好名称无效".to_owned());
    }
    validate_preference(&scope, &key, &value)?;
    save(db.inner(), &scope, &key, &value).await?;
    // 数据已提交，通知失败不能把成功写入报告为失败
    if let Err(error) = app.emit("ui-preferences-changed", ()) {
        log::warn!("偏好同步通知失败: {error}");
    }
    Ok(())
}

/// 校验外观偏好的业务类型和值域
fn validate_preference(scope: &str, key: &str, value: &Value) -> Result<(), String> {
    if scope == "radio" {
        let valid = match key {
            "volume" => value
                .as_f64()
                .is_some_and(|number| (0.0..=1.0).contains(&number)),
            "isMuted" => value.is_boolean(),
            "channel" => value.as_object().is_some_and(|channel| {
                channel.len() == 3
                    && channel
                        .get("id")
                        .and_then(Value::as_i64)
                        .is_some_and(|id| id > 0)
                    && channel
                        .get("title")
                        .and_then(Value::as_str)
                        .is_some_and(|title| !title.is_empty() && title.len() <= 4096)
                    && channel
                        .get("coverUrl")
                        .and_then(Value::as_str)
                        .is_some_and(|url| url.len() <= 8192)
            }),
            _ => false,
        };
        return if valid {
            Ok(())
        } else {
            Err("电台偏好无效".into())
        };
    }
    if scope == "player" {
        let valid = match key {
            "playbackRate" => value
                .as_f64()
                .is_some_and(|number| (0.25..=3.0).contains(&number)),
            "seekStep" => value
                .as_f64()
                .is_some_and(|number| (1.0..=30.0).contains(&number)),
            "loop" | "autoNext" => value.is_boolean(),
            _ => false,
        };
        return if valid {
            Ok(())
        } else {
            Err("播放器偏好无效".into())
        };
    }
    if matches!(scope, "iptv" | "catalog") && key == "selectedSource" {
        return if value.as_str().is_some_and(|id| id.len() <= 128) {
            Ok(())
        } else {
            Err("源标识无效".into())
        };
    }
    if scope == "iptv-selection" {
        let valid = value.as_object().is_some_and(|item| {
            item.len() == 3
                && item
                    .get("channelId")
                    .and_then(Value::as_str)
                    .is_some_and(|id| id.len() <= 512)
                && item
                    .get("streamId")
                    .and_then(Value::as_str)
                    .is_some_and(|id| id.len() <= 512)
                && item
                    .get("expandedGroups")
                    .and_then(Value::as_array)
                    .is_some_and(|groups| {
                        groups.len() <= 1000
                            && groups
                                .iter()
                                .all(|group| group.as_str().is_some_and(|name| name.len() <= 1024))
                    })
        });
        return if valid {
            Ok(())
        } else {
            Err("直播选择状态无效".into())
        };
    }
    let valid = scope == "appearance"
        && match key {
            "searchViewMode" => matches!(value.as_str(), Some("grouped" | "source")),
            "theme" => matches!(value.as_str(), Some("light" | "dark" | "system")),
            "appStyle" => matches!(value.as_str(), Some("catalog" | "trending")),
            "linkPlayer" | "radio" | "skipDisclaimer" => value.is_boolean(),
            _ => false,
        };
    if valid {
        Ok(())
    } else {
        Err("不支持的偏好或偏好值无效".to_owned())
    }
}

/// 原子更新单个偏好，保留其他窗口修改的字段
async fn save(db: &SqlitePool, scope: &str, key: &str, value: &Value) -> Result<(), String> {
    sqlx::query("INSERT INTO ui_preferences (scope, key, value, updated_at) VALUES (?, ?, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER)) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .bind(scope).bind(key).bind(value.to_string())
        .execute(db).await.map_err(|_| "保存偏好失败".to_owned())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 拒绝未知偏好、非法主题和错误类型
    #[test]
    fn rejects_invalid_preferences() {
        assert!(validate_preference("appearance", "theme", &json!("dark")).is_ok());
        assert!(validate_preference("appearance", "theme", &json!("unknown")).is_err());
        assert!(validate_preference("appearance", "radio", &json!("true")).is_err());
        assert!(validate_preference("unknown", "radio", &json!(true)).is_err());
    }

    /// 拒绝非法播放器范围和直播选择结构
    #[test]
    fn validates_playback_preferences() {
        assert!(validate_preference("player", "playbackRate", &json!(1.5)).is_ok());
        assert!(validate_preference("player", "playbackRate", &json!(0)).is_err());
        assert!(validate_preference("player", "seekStep", &json!(31)).is_err());
        assert!(validate_preference("player", "loop", &json!("true")).is_err());
        assert!(validate_preference(
            "iptv-selection",
            "source",
            &json!({"channelId":"1","streamId":"2","expandedGroups":["新闻"]})
        )
        .is_ok());
        assert!(validate_preference(
            "iptv-selection",
            "source",
            &json!({"channelId":1,"streamId":"2","expandedGroups":[]})
        )
        .is_err());
    }

    /// 验证迁移、覆盖保存和不同偏好之间的数据隔离
    #[tokio::test]
    async fn persists_independent_preferences() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        save(&db, "appearance", "theme", &json!("light"))
            .await
            .unwrap();
        save(&db, "appearance", "radio", &json!(false))
            .await
            .unwrap();
        save(&db, "appearance", "theme", &json!("dark"))
            .await
            .unwrap();
        let rows = sqlx::query_as::<_, PreferenceRow>(
            "SELECT key, value FROM ui_preferences ORDER BY key",
        )
        .fetch_all(&db)
        .await
        .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].value, "false");
        assert_eq!(rows[1].value, "\"dark\"");
        db.close().await;
    }
}
