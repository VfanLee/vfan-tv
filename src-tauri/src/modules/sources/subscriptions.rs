#[cfg(test)]
use super::list;
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

#[cfg(test)]
mod subscription_tests {
    use super::super::exchange::import;
    use super::*;
    /// 直播源与手动源冲突时，点播替换和当前订阅切换也必须回滚
    #[tokio::test]
    async fn subscription_conflict_preserves_both_categories() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        sqlx::query("INSERT INTO subscriptions VALUES('sub','https://sub.test/',0,1,NULL)")
            .execute(&db)
            .await
            .unwrap();
        import(
            &db,
            SourceKind::Iptv,
            serde_json::json!({"name":"manual","url":"https://live.test/"}),
        )
        .await
        .unwrap();
        let initial = serde_json::from_value(
            serde_json::json!({"vod":[{"name":"old","url":"https://old.test/"}],"iptv":[]}),
        )
        .unwrap();
        apply_subscription(&db, "sub", "https://sub.test/", initial)
            .await
            .unwrap();
        let conflict=serde_json::from_value(serde_json::json!({"vod":[{"name":"new","url":"https://new.test/"}],"iptv":[{"name":"collision","url":"https://live.test/"}]})).unwrap();
        assert!(
            apply_subscription(&db, "sub", "https://sub.test/", conflict)
                .await
                .is_err()
        );
        assert_eq!(list(&db, SourceKind::Vod).await.unwrap()[0].name, "old");
        assert!(list(&db, SourceKind::Iptv).await.unwrap()[0]
            .subscription_id
            .is_none());
        db.close().await;
    }

    /// 重复同步保留源标识、用户引用和创建时间，只处理实际增删改
    #[tokio::test]
    async fn resync_preserves_source_identity_and_references() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        sqlx::query("INSERT INTO subscriptions VALUES('sub','https://sub.test/',0,1,NULL)")
            .execute(&db)
            .await
            .unwrap();
        let initial = serde_json::json!({"vod":[{"name":"A","url":"https://a.test/"},{"name":"B","url":"https://b.test/"}],"iptv":[]});
        apply_subscription(
            &db,
            "sub",
            "https://sub.test/",
            serde_json::from_value(initial.clone()).unwrap(),
        )
        .await
        .unwrap();
        let before = list(&db, SourceKind::Vod).await.unwrap();
        let original = &before[0];
        sqlx::query("UPDATE sources SET created_at=123,updated_at=456,remark='note' WHERE id=?")
            .bind(&original.id)
            .execute(&db)
            .await
            .unwrap();
        sqlx::query("INSERT INTO favorites(source_id,vod_id,source_name,title,created_at,updated_at) VALUES(?,'video','A','Film',1,1)").bind(&original.id).execute(&db).await.unwrap();
        sqlx::query("INSERT INTO ui_preferences VALUES('catalog','selectedSource',json_quote(?))")
            .bind(&original.id)
            .execute(&db)
            .await
            .unwrap();
        let result = apply_subscription(
            &db,
            "sub",
            "https://sub.test/",
            serde_json::from_value(initial).unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(
            result["vod"],
            serde_json::json!({"created":0,"updated":0,"unchanged":2})
        );
        assert_eq!(list(&db, SourceKind::Vod).await.unwrap()[0].updated_at, 456);
        let changed = serde_json::json!({"vod":[{"name":"renamed","url":"https://a.test/","headers":{"X-Test":"value"}},{"name":"C","url":"https://c.test/"}],"iptv":[]});
        let result = apply_subscription(
            &db,
            "sub",
            "https://sub.test/",
            serde_json::from_value(changed).unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(
            result["vod"],
            serde_json::json!({"created":1,"updated":1,"unchanged":0})
        );
        let after = list(&db, SourceKind::Vod).await.unwrap();
        assert_eq!(
            (
                &after[0].id,
                after[0].created_at,
                after[0].sort,
                after[0].remark.as_deref()
            ),
            (&original.id, 123, original.sort, Some("note"))
        );
        assert_eq!(after[0].name, "renamed");
        assert!(!after.iter().any(|source| source.id == before[1].id));
        let references: i64 = sqlx::query_scalar("SELECT count(*) FROM favorites JOIN sources ON favorites.source_id=sources.id JOIN ui_preferences ON json_extract(value,'$')=sources.id WHERE scope='catalog' AND key='selectedSource'").fetch_one(&db).await.unwrap();
        assert_eq!(references, 1);
        db.close().await;
    }

    /// 同步一个订阅不影响其他订阅的源，删除订阅则级联清理
    #[tokio::test]
    async fn subscriptions_own_their_sources_independently() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        sqlx::query("INSERT INTO subscriptions VALUES('a','https://a.test/',0,1,NULL),('b','https://b.test/',1,1,NULL)")
            .execute(&db)
            .await
            .unwrap();
        for (id, url, name) in [
            ("a", "https://a.test/", "from-a"),
            ("b", "https://b.test/", "from-b"),
        ] {
            let payload = serde_json::from_value(
                serde_json::json!({"vod":[{"name":name,"url":format!("https://{name}.test/")}],"iptv":[]}),
            )
            .unwrap();
            apply_subscription(&db, id, url, payload).await.unwrap();
        }
        // 同步 b 之后 a 的源仍在
        let names: Vec<String> = list(&db, SourceKind::Vod)
            .await
            .unwrap()
            .into_iter()
            .map(|source| source.name)
            .collect();
        assert_eq!(names, vec!["from-a", "from-b"]);
        sqlx::query("DELETE FROM subscriptions WHERE id='a'")
            .execute(&db)
            .await
            .unwrap();
        let remaining: Vec<String> = list(&db, SourceKind::Vod)
            .await
            .unwrap()
            .into_iter()
            .map(|source| source.name)
            .collect();
        assert_eq!(remaining, vec!["from-b"]);
        db.close().await;
    }
}
