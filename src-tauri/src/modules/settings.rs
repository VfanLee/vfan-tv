use crate::modules::network_settings;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use tauri::State;

#[derive(Serialize, Deserialize, FromRow)]
pub struct Subscription {
    id: String,
    url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    theme: String,
    subscriptions: Vec<Subscription>,
    #[serde(skip_serializing_if = "Option::is_none")]
    active_subscription_id: Option<String>,
    network: network_settings::NetworkSettings,
}

/// 读取设置，主题仅使用外观偏好的唯一存储位置
#[tauri::command]
pub async fn get_settings(db: State<'_, SqlitePool>) -> Result<AppSettings, String> {
    let network = network_settings::read(&db).await?;
    let mut tx = db.begin().await.map_err(|_| "读取设置失败")?;
    let theme: Option<String> = sqlx::query_scalar("SELECT json_extract(value,'$') FROM ui_preferences WHERE scope='appearance' AND key='theme'")
        .fetch_optional(&mut *tx).await.map_err(|_| "读取主题失败")?;
    let subscriptions = sqlx::query_as("SELECT id,url FROM subscriptions ORDER BY sort,id")
        .fetch_all(&mut *tx)
        .await
        .map_err(|_| "读取订阅失败")?;
    let active_subscription_id = sqlx::query_scalar(
        "SELECT json_extract(value,'$') FROM app_settings WHERE key='activeSubscriptionId'",
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| "读取当前订阅失败")?
    .flatten();
    tx.commit().await.map_err(|_| "读取设置失败")?;
    Ok(AppSettings {
        theme: theme.unwrap_or_else(|| "system".into()),
        subscriptions,
        active_subscription_id,
        network,
    })
}

/// 校验并在单一事务中更新订阅列表、当前订阅和主题
async fn update(db: &SqlitePool, input: serde_json::Value) -> Result<(), String> {
    let patch = input.as_object().ok_or("设置参数必须是对象")?;
    if patch.keys().any(|key| {
        !matches!(
            key.as_str(),
            "theme" | "subscriptions" | "activeSubscriptionId"
        )
    }) {
        return Err("设置字段无效，网络配置请使用网络设置接口".to_owned());
    }
    let subscriptions = patch
        .get("subscriptions")
        .map(|value| {
            serde_json::from_value::<Vec<Subscription>>(value.clone())
                .map_err(|_| "订阅列表格式无效")
        })
        .transpose()?;
    let mut tx = db.begin().await.map_err(|_| "无法开始设置修改")?;
    if let Some(subscriptions) = subscriptions {
        let mut ids = std::collections::HashSet::new();
        let mut urls = std::collections::HashSet::new();
        sqlx::query("DELETE FROM subscriptions")
            .execute(&mut *tx)
            .await
            .map_err(|_| "更新订阅列表失败")?;
        for (index, subscription) in subscriptions.into_iter().enumerate() {
            let url =
                crate::infrastructure::network::parse_http_url(&subscription.url)?.to_string();
            if subscription.id.trim().is_empty()
                || !ids.insert(subscription.id.clone())
                || !urls.insert(url.clone())
            {
                return Err("订阅标识或地址重复或无效".to_owned());
            }
            sqlx::query("INSERT INTO subscriptions(id,url,sort) VALUES(?,?,?)")
                .bind(subscription.id)
                .bind(url)
                .bind(index as i64)
                .execute(&mut *tx)
                .await
                .map_err(|_| "保存订阅失败")?;
        }
    }
    if let Some(active) = patch.get("activeSubscriptionId") {
        if !active.is_null() && !active.is_string() {
            return Err("当前订阅标识无效".to_owned());
        }
        sqlx::query("INSERT INTO app_settings(key,value) VALUES('activeSubscriptionId',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(active.to_string()).execute(&mut *tx).await.map_err(|_| "保存当前订阅失败")?;
    }
    // 列表替换后移除悬空引用，显式指定不存在的订阅则整次修改失败
    let active: Option<String> = sqlx::query_scalar(
        "SELECT json_extract(value,'$') FROM app_settings WHERE key='activeSubscriptionId'",
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| "读取当前订阅失败")?
    .flatten();
    if let Some(id) = active {
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM subscriptions WHERE id=?)")
                .bind(id)
                .fetch_one(&mut *tx)
                .await
                .map_err(|_| "校验当前订阅失败")?;
        if !exists {
            if patch
                .get("activeSubscriptionId")
                .is_some_and(|value| !value.is_null())
            {
                return Err("所选订阅不存在".to_owned());
            }
            sqlx::query("DELETE FROM app_settings WHERE key='activeSubscriptionId'")
                .execute(&mut *tx)
                .await
                .map_err(|_| "清理当前订阅失败")?;
        }
    }
    if let Some(theme) = patch.get("theme") {
        if !matches!(theme.as_str(), Some("light" | "dark" | "system")) {
            return Err("主题无效".to_owned());
        }
        sqlx::query("INSERT INTO ui_preferences(scope,key,value,updated_at) VALUES('appearance','theme',?,CAST(unixepoch('subsec')*1000 AS INTEGER)) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(theme.to_string()).execute(&mut *tx).await.map_err(|_| "保存主题失败")?;
    }
    tx.commit().await.map_err(|_| "提交设置失败")?;
    Ok(())
}

/// 保存设置并同步窗口中的配置和外观
#[tauri::command]
pub async fn update_settings(
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
    input: serde_json::Value,
) -> Result<AppSettings, String> {
    use tauri::Emitter;
    update(&db, input).await?;
    if let Err(error) = app.emit("app-data-changed", "settings") {
        log::warn!("设置通知失败: {error}");
    }
    if let Err(error) = app.emit("ui-preferences-changed", ()) {
        log::warn!("外观通知失败: {error}");
    }
    get_settings(db).await
}

#[cfg(test)]
mod tests {
    use super::*;
    /// 无效当前订阅不能部分覆盖已有订阅列表和主题
    #[tokio::test]
    async fn invalid_active_subscription_rolls_back_settings() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        update(&db,serde_json::json!({"subscriptions":[{"id":"a","url":"https://a.test/sub"}],"activeSubscriptionId":"a","theme":"dark"})).await.unwrap();
        assert!(update(
            &db,
            serde_json::json!({"subscriptions":[],"activeSubscriptionId":"missing","theme":"light"})
        )
        .await
        .is_err());
        let id: String = sqlx::query_scalar("SELECT id FROM subscriptions")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(id, "a");
        let theme: String = sqlx::query_scalar(
            "SELECT json_extract(value,'$') FROM ui_preferences WHERE key='theme'",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(theme, "dark");
        update(&db, serde_json::json!({"subscriptions":[]}))
            .await
            .unwrap();
        let active: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM app_settings WHERE key='activeSubscriptionId'",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(active, 0);
        db.close().await;
    }
}
