use super::repository::{
    list_in_transaction, normalize, validate_changes, write_source, SourceChange,
};
use super::{notify_selections, Source, SourceInput, SourceKind};
use crate::infrastructure::{diagnostics::command_error, network};
use crate::modules::settings;
use serde::Deserialize;
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use tauri::{Emitter, State};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SubscriptionPayload {
    vod: Vec<SourceInput>,
    iptv: Vec<SourceInput>,
}

/// 在同一事务中替换订阅源，保留手动源并校验全部地址冲突
async fn apply_subscription(
    db: &SqlitePool,
    id: &str,
    url: &str,
    payload: SubscriptionPayload,
) -> Result<serde_json::Value, String> {
    let mut tx = db
        .begin()
        .await
        .map_err(|error| command_error("无法开始订阅同步", &error))?;
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM subscriptions WHERE id=? AND url=?)")
            .bind(id)
            .bind(url)
            .fetch_one(&mut *tx)
            .await
            .map_err(|error| command_error("读取订阅失败", &error))?;
    if !exists {
        return Err("订阅已被删除或修改，请重试".into());
    }
    let mut counts = Vec::new();
    for (kind, items) in [
        (SourceKind::Vod, payload.vod),
        (SourceKind::Iptv, payload.iptv),
    ] {
        let existing = list_in_transaction(&mut tx, kind).await?;
        let by_url: HashMap<&str, &Source> = existing
            .iter()
            .filter(|source| source.subscription_id.as_deref() == Some(id))
            .map(|source| (source.url.as_str(), source))
            .collect();
        let mut positions = HashMap::new();
        let mut unique = Vec::new();
        for item in items {
            let item = normalize(item, kind)?;
            if let Some(&index) = positions.get(&item.name) {
                unique[index] = item;
            } else {
                positions.insert(item.name.clone(), unique.len());
                unique.push(item);
            }
        }
        let changes: Vec<_> = unique
            .into_iter()
            .map(|input| SourceChange {
                existing: by_url.get(input.url.as_str()).copied(),
                input,
            })
            .collect();
        let retained: HashSet<&str> = changes
            .iter()
            .filter_map(|change| change.existing.map(|source| source.id.as_str()))
            .collect();
        let removed: HashSet<&str> = by_url
            .values()
            .filter(|source| !retained.contains(source.id.as_str()))
            .map(|source| source.id.as_str())
            .collect();
        validate_changes(&existing, &changes, &removed)?;
        sqlx::query("DELETE FROM sources WHERE id IN (SELECT value FROM json_each(?))")
            .bind(serde_json::json!(removed).to_string())
            .execute(&mut *tx)
            .await
            .map_err(|error| command_error("更新订阅源失败", &error))?;
        let mut created = 0;
        let mut updated = 0;
        let mut unchanged = 0;
        let mut next_sort = existing
            .iter()
            .map(|source| source.sort)
            .max()
            .map_or(0, |sort| sort + 1);
        for change in changes {
            if change.unchanged() {
                unchanged += 1;
                continue;
            }
            write_source(&mut tx, kind, &change, Some(id), &mut next_sort).await?;
            if change.existing.is_some() {
                updated += 1;
            } else {
                created += 1;
            }
        }
        counts.push(serde_json::json!({"created":created,"updated":updated,"unchanged":unchanged}));
    }
    settings::set_active_subscription(&mut tx, Some(id)).await?;
    let now: i64 = sqlx::query_scalar(
        "UPDATE subscriptions SET synced_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE id=? RETURNING synced_at",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await.map_err(|error| command_error("保存同步时间失败", &error))?;
    tx.commit()
        .await
        .map_err(|error| command_error("提交订阅失败", &error))?;
    Ok(serde_json::json!({"vod":counts[0],"iptv":counts[1],"updatedAt":now}))
}

/// 下载并解码现有 Base58 订阅格式，限制响应大小与总时间
#[tauri::command]
pub async fn sync_source_subscription(
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
    subscription_id: String,
    mode: network::NetworkMode,
) -> Result<serde_json::Value, String> {
    let url: String = sqlx::query_scalar("SELECT url FROM subscriptions WHERE id=?")
        .bind(&subscription_id)
        .fetch_optional(db.inner())
        .await
        .map_err(|error| command_error("读取订阅失败", &error))?
        .ok_or("订阅不存在")?;
    let client = network::create_client(&mode)?;
    let bytes = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        let response = network::request(
            &client,
            reqwest::Method::GET,
            network::parse_http_url(&url)?,
            Default::default(),
        )
        .await?;
        if !response.status().is_success() {
            return Err(format!("订阅返回 HTTP {}", response.status().as_u16()));
        }
        let bytes = network::read_limited(response, 2 * 1024 * 1024)
            .await
            .map_err(|error| match error {
                network::BodyReadError::Read(error) => command_error("读取订阅失败", &error),
                network::BodyReadError::TooLarge => "订阅超过 2 MiB 限制".to_owned(),
            })?;
        Ok(bytes)
    })
    .await
    .map_err(|error| command_error("订阅下载超时", &error))??;
    let payload =
        tauri::async_runtime::spawn_blocking(move || -> Result<SubscriptionPayload, String> {
            let encoded = String::from_utf8(bytes).map_err(|_| "订阅编码无效")?;
            let decoded = bs58::decode(encoded.trim())
                .into_vec()
                .map_err(|_| "订阅不是有效的 Base58 内容")?;
            serde_json::from_slice(&decoded).map_err(|_| "订阅 JSON 格式无效".to_owned())
        })
        .await
        .map_err(|error| command_error("订阅解码任务失败", &error))??;
    let result = apply_subscription(&db, &subscription_id, &url, payload).await?;
    notify_selections(&app);
    if let Err(error) = app.emit("app-data-changed", "app-data") {
        log::warn!("订阅通知失败: {error}");
    }
    Ok(result)
}

/// 删除订阅，其源数据由外键级联清理
#[tauri::command]
pub async fn delete_source_subscription(
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
    subscription_id: String,
) -> Result<(), String> {
    let mut tx = db
        .begin()
        .await
        .map_err(|error| command_error("无法删除订阅", &error))?;
    let deleted = sqlx::query("DELETE FROM subscriptions WHERE id=?")
        .bind(&subscription_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| command_error("删除订阅失败", &error))?;
    if deleted.rows_affected() == 0 {
        return Err("订阅不存在".into());
    }
    // 当前订阅被删除后回退到排序最靠前的剩余订阅
    let active = settings::active_subscription(&mut tx).await?;
    if active.as_deref() == Some(subscription_id.as_str()) {
        let fallback: Option<String> =
            sqlx::query_scalar("SELECT id FROM subscriptions ORDER BY sort,id LIMIT 1")
                .fetch_optional(&mut *tx)
                .await
                .map_err(|error| command_error("读取剩余订阅失败", &error))?;
        settings::set_active_subscription(&mut tx, fallback.as_deref()).await?;
    }
    tx.commit()
        .await
        .map_err(|error| command_error("提交删除失败", &error))?;
    notify_selections(&app);
    if let Err(error) = app.emit("app-data-changed", "app-data") {
        log::warn!("订阅通知失败: {error}");
    }
    Ok(())
}
