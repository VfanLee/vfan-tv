use crate::infrastructure::diagnostics::command_error;
use crate::modules::network_settings;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use tauri::State;

#[derive(Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    id: String,
    url: String,
    /// 最近一次成功同步时间，未同步过为空
    #[serde(default, skip_serializing_if = "Option::is_none")]
    synced_at: Option<i64>,
}

/// 读取当前选中的订阅标识
pub async fn active_subscription(
    connection: &mut sqlx::SqliteConnection,
) -> Result<Option<String>, String> {
    sqlx::query_scalar(
        "SELECT json_extract(value,'$') FROM ui_preferences WHERE scope='subscription' AND key='activeId'",
    )
    .fetch_optional(&mut *connection)
    .await.map_err(|error| command_error("读取当前订阅失败", &error))
    .map(Option::flatten)
}

/// 写入或清除当前选中的订阅标识
pub async fn set_active_subscription(
    connection: &mut sqlx::SqliteConnection,
    id: Option<&str>,
) -> Result<(), String> {
    match id {
        Some(id) => sqlx::query("INSERT INTO ui_preferences(scope,key,value) VALUES('subscription','activeId',json_quote(?)) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value").bind(id).execute(&mut *connection).await,
        None => sqlx::query("DELETE FROM ui_preferences WHERE scope='subscription' AND key='activeId'").execute(&mut *connection).await,
    }
    .map_err(|error| command_error("保存当前订阅失败", &error))?;
    Ok(())
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
    let mut tx = db
        .begin()
        .await
        .map_err(|error| command_error("读取设置失败", &error))?;
    let theme: Option<String> = sqlx::query_scalar("SELECT json_extract(value,'$') FROM ui_preferences WHERE scope='appearance' AND key='theme'")
        .fetch_optional(&mut *tx).await.map_err(|error| command_error("读取主题失败", &error))?;
    let subscriptions =
        sqlx::query_as("SELECT id,url,synced_at FROM subscriptions ORDER BY sort,id")
            .fetch_all(&mut *tx)
            .await
            .map_err(|error| command_error("读取订阅失败", &error))?;
    let active_subscription_id = active_subscription(&mut tx).await?;
    tx.commit()
        .await
        .map_err(|error| command_error("读取设置失败", &error))?;
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
    let mut tx = db
        .begin()
        .await
        .map_err(|error| command_error("无法开始设置修改", &error))?;
    if let Some(subscriptions) = subscriptions {
        let mut ids = std::collections::HashSet::new();
        let mut urls = std::collections::HashSet::new();
        let mut normalized = Vec::with_capacity(subscriptions.len());
        for subscription in subscriptions {
            let url =
                crate::infrastructure::network::parse_http_url(&subscription.url)?.to_string();
            if subscription.id.trim().is_empty()
                || !ids.insert(subscription.id.clone())
                || !urls.insert(url.clone())
            {
                return Err("订阅标识或地址重复或无效".to_owned());
            }
            normalized.push((subscription.id, url));
        }
        // 仅移除不再保留的订阅，保留其他订阅的源和同步记录
        sqlx::query("DELETE FROM subscriptions WHERE id NOT IN (SELECT value FROM json_each(?))")
            .bind(serde_json::json!(ids).to_string())
            .execute(&mut *tx)
            .await
            .map_err(|error| command_error("更新订阅列表失败", &error))?;
        for (index, (id, url)) in normalized.into_iter().enumerate() {
            sqlx::query("INSERT INTO subscriptions(id,url,sort,created_at) VALUES(?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER)) ON CONFLICT(id) DO UPDATE SET url=excluded.url,sort=excluded.sort,synced_at=CASE WHEN subscriptions.url=excluded.url THEN subscriptions.synced_at ELSE NULL END")
                .bind(id)
                .bind(url)
                .bind(index as i64)
                .execute(&mut *tx)
                .await.map_err(|error| command_error("保存订阅失败", &error))?;
        }
    }
    if let Some(active) = patch.get("activeSubscriptionId") {
        match active {
            serde_json::Value::Null => set_active_subscription(&mut tx, None).await?,
            serde_json::Value::String(id) => set_active_subscription(&mut tx, Some(id)).await?,
            _ => return Err("当前订阅标识无效".to_owned()),
        }
    }
    // 列表替换后移除悬空引用，显式指定不存在的订阅则整次修改失败
    if let Some(id) = active_subscription(&mut tx).await? {
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM subscriptions WHERE id=?)")
                .bind(id)
                .fetch_one(&mut *tx)
                .await
                .map_err(|error| command_error("校验当前订阅失败", &error))?;
        if !exists {
            if patch
                .get("activeSubscriptionId")
                .is_some_and(|value| !value.is_null())
            {
                return Err("所选订阅不存在".to_owned());
            }
            set_active_subscription(&mut tx, None).await?;
        }
    }
    if let Some(theme) = patch.get("theme") {
        if !matches!(theme.as_str(), Some("light" | "dark" | "system")) {
            return Err("主题无效".to_owned());
        }
        sqlx::query("INSERT INTO ui_preferences(scope,key,value) VALUES('appearance','theme',?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value").bind(theme.to_string()).execute(&mut *tx).await.map_err(|error| command_error("保存主题失败", &error))?;
    }
    tx.commit()
        .await
        .map_err(|error| command_error("提交设置失败", &error))?;
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
            "SELECT count(*) FROM ui_preferences WHERE scope='subscription' AND key='activeId'",
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(active, 0);
        db.close().await;
    }

    /// 新增、重排和撤销新增订阅时保留原有源及同步时间
    #[tokio::test]
    async fn editing_subscription_list_preserves_retained_sources() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        sqlx::query("INSERT INTO subscriptions VALUES('a','https://a.test/',0,100,200)")
            .execute(&db)
            .await
            .unwrap();
        sqlx::query("INSERT INTO sources(id,kind,name,url,sort,subscription_id,created_at,updated_at) VALUES('source-a','vod','A','https://source.test/',0,'a',100,100)").execute(&db).await.unwrap();
        update(&db, serde_json::json!({"subscriptions":[{"id":"b","url":"https://b.test/"},{"id":"a","url":"https://a.test/"}],"activeSubscriptionId":"b"})).await.unwrap();
        let preserved: (String, i64, i64, i64) = sqlx::query_as("SELECT sources.id,subscriptions.created_at,synced_at,subscriptions.sort FROM sources JOIN subscriptions ON subscription_id=subscriptions.id").fetch_one(&db).await.unwrap();
        assert_eq!(preserved, ("source-a".into(), 100, 200, 1));
        // 模拟新增订阅同步失败，撤销新增项
        update(&db, serde_json::json!({"subscriptions":[{"id":"a","url":"https://a.test/"}],"activeSubscriptionId":null})).await.unwrap();
        let preserved: (String, i64, i64) = sqlx::query_as("SELECT sources.id,subscriptions.created_at,synced_at FROM sources JOIN subscriptions ON subscription_id=subscriptions.id").fetch_one(&db).await.unwrap();
        assert_eq!(preserved, ("source-a".into(), 100, 200));
        // 显式移除订阅仍会级联清理其源
        update(&db, serde_json::json!({"subscriptions":[]}))
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sources")
                .fetch_one(&db)
                .await
                .unwrap(),
            0
        );
        db.close().await;
    }

    /// 当前订阅标识以合法 JSON 字符串写入偏好表
    #[tokio::test]
    async fn active_subscription_round_trips() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        let mut connection = db.acquire().await.unwrap();
        set_active_subscription(&mut connection, Some("sub-1"))
            .await
            .unwrap();
        assert_eq!(
            active_subscription(&mut connection)
                .await
                .unwrap()
                .as_deref(),
            Some("sub-1")
        );
        set_active_subscription(&mut connection, None)
            .await
            .unwrap();
        assert!(active_subscription(&mut connection)
            .await
            .unwrap()
            .is_none());
        drop(connection);
        db.close().await;
    }
}
