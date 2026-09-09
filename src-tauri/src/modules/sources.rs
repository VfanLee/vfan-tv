use crate::infrastructure::network;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use std::collections::{BTreeMap, HashSet};
use tauri::{Emitter, State};
use uuid::Uuid;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    Vod,
    Iptv,
}

impl SourceKind {
    /// 返回数据库中稳定的源类型标识
    fn key(self) -> &'static str {
        match self {
            Self::Vod => "vod",
            Self::Iptv => "iptv",
        }
    }
}

#[derive(Clone, Deserialize, Serialize, PartialEq)]
pub struct SourceInput {
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub backups: Vec<String>,
}

#[derive(Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub name: String,
    pub url: String,
    pub disabled: bool,
    #[sqlx(json)]
    pub headers: BTreeMap<String, String>,
    #[sqlx(json)]
    pub backups: Vec<String>,
    pub sort: i64,
    pub origin: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remark: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 规范化源地址与请求头，不改变来源域的凭据语义
fn normalize(mut input: SourceInput, kind: SourceKind) -> Result<SourceInput, String> {
    input.name = input.name.trim().to_owned();
    if input.name.is_empty() {
        return Err("源名称不能为空".to_owned());
    }
    let url = network::parse_http_url(&input.url)?;
    input.url = url.to_string();
    let headers = network::source_headers(&url, &url, &input.headers)?;
    input.headers = headers
        .iter()
        .map(|(name, value)| {
            Ok((
                name.to_string(),
                value.to_str().map_err(|_| "请求头格式无效")?.to_owned(),
            ))
        })
        .collect::<Result<_, String>>()?;
    let mut seen = HashSet::from([input.url.clone()]);
    let mut backups = Vec::new();
    if matches!(kind, SourceKind::Vod) {
        for raw in input.backups {
            let url = network::parse_http_url(&raw)?.to_string();
            if seen.insert(url.clone()) {
                backups.push(url);
            }
        }
    }
    input.backups = backups;
    Ok(input)
}

/// 读取指定类别的源列表
pub async fn list(db: &SqlitePool, kind: SourceKind) -> Result<Vec<Source>, String> {
    sqlx::query_as("SELECT * FROM sources WHERE kind = ? ORDER BY sort, id")
        .bind(kind.key())
        .fetch_all(db)
        .await
        .map_err(|_| "读取源列表失败".to_owned())
}

/// 查找指定类别中的源
pub async fn find(db: &SqlitePool, kind: SourceKind, id: &str) -> Result<Source, String> {
    sqlx::query_as("SELECT * FROM sources WHERE kind = ? AND id = ?")
        .bind(kind.key())
        .bind(id)
        .fetch_optional(db)
        .await
        .map_err(|_| "读取源失败")?
        .ok_or("数据源不存在".to_owned())
}

/// 在事务中校验地址唯一性并新增或更新源
async fn save(
    db: &SqlitePool,
    kind: SourceKind,
    id: Option<String>,
    input: SourceInput,
) -> Result<Source, String> {
    let mut tx = db.begin().await.map_err(|_| "无法开始源修改")?;
    let row = save_in_transaction(&mut tx, kind, id, input).await?;
    tx.commit().await.map_err(|_| "提交源修改失败")?;
    Ok(row)
}

/// 在调用方事务中保存源，批量导入共享相同的地址校验
async fn save_in_transaction(
    connection: &mut sqlx::SqliteConnection,
    kind: SourceKind,
    id: Option<String>,
    input: SourceInput,
) -> Result<Source, String> {
    let input = normalize(input, kind)?;
    let existing: Vec<Source> =
        sqlx::query_as("SELECT * FROM sources WHERE kind = ? ORDER BY sort")
            .bind(kind.key())
            .fetch_all(&mut *connection)
            .await
            .map_err(|_| "读取源列表失败")?;
    if id
        .as_ref()
        .is_some_and(|id| !existing.iter().any(|source| &source.id == id))
    {
        return Err("数据源不存在".to_owned());
    }
    let requested: HashSet<&str> = std::iter::once(input.url.as_str())
        .chain(input.backups.iter().map(String::as_str))
        .collect();
    for source in &existing {
        if Some(&source.id) == id.as_ref() {
            continue;
        }
        if std::iter::once(source.url.as_str())
            .chain(source.backups.iter().map(String::as_str))
            .any(|url| requested.contains(url))
        {
            return Err("源地址或备用地址已被其他源使用".to_owned());
        }
    }
    let sort = existing
        .iter()
        .map(|source| source.sort)
        .max()
        .map_or(0, |sort| sort + 1);
    let id = id.unwrap_or_else(|| Uuid::new_v4().to_string());
    sqlx::query("INSERT INTO sources (id,kind,name,url,disabled,headers,backups,sort,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER),CAST(unixepoch('subsec')*1000 AS INTEGER)) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,disabled=excluded.disabled,headers=excluded.headers,backups=excluded.backups,updated_at=excluded.updated_at")
        .bind(&id).bind(kind.key()).bind(&input.name).bind(&input.url).bind(input.disabled).bind(sqlx::types::Json(&input.headers)).bind(sqlx::types::Json(&input.backups)).bind(sort).execute(&mut *connection).await.map_err(|_| "保存源失败")?;
    let row = sqlx::query_as("SELECT * FROM sources WHERE id = ?")
        .bind(&id)
        .fetch_one(&mut *connection)
        .await
        .map_err(|_| "读取保存结果失败")?;
    Ok(row)
}

/// 通知各窗口刷新源列表
fn notify(app: &tauri::AppHandle, kind: SourceKind) {
    let domain = match kind {
        SourceKind::Vod => "vod-sources",
        SourceKind::Iptv => "iptv-sources",
    };
    if let Err(error) = app.emit("app-data-changed", domain) {
        log::warn!("源变更通知失败: {error}");
    }
}

/// 返回当前源列表
#[tauri::command]
pub async fn list_sources(
    db: State<'_, SqlitePool>,
    kind: SourceKind,
) -> Result<Vec<Source>, String> {
    list(&db, kind).await
}

/// 新建源配置
#[tauri::command]
pub async fn create_source(
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
    kind: SourceKind,
    input: SourceInput,
) -> Result<Source, String> {
    let result = save(&db, kind, None, input).await?;
    notify(&app, kind);
    Ok(result)
}

/// 更新指定源配置
#[tauri::command]
pub async fn update_source(
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
    kind: SourceKind,
    id: String,
    input: SourceInput,
) -> Result<Source, String> {
    let result = save(&db, kind, Some(id), input).await?;
    notify(&app, kind);
    Ok(result)
}

/// 删除源配置或清空指定类别
#[tauri::command]
pub async fn delete_sources(
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
    kind: SourceKind,
    id: Option<String>,
) -> Result<(), String> {
    let result = sqlx::query("DELETE FROM sources WHERE kind = ? AND (? IS NULL OR id = ?)")
        .bind(kind.key())
        .bind(&id)
        .bind(&id)
        .execute(db.inner())
        .await
        .map_err(|_| "删除源失败")?;
    if id.is_some() && result.rows_affected() == 0 {
        return Err("数据源不存在".to_owned());
    }
    notify(&app, kind);
    Ok(())
}

/// 校验完整排序列表并原子更新
#[tauri::command]
pub async fn reorder_sources(
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
    kind: SourceKind,
    source_ids: Vec<String>,
) -> Result<Vec<Source>, String> {
    let mut tx = db.begin().await.map_err(|_| "无法开始排序")?;
    let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM sources WHERE kind = ?")
        .bind(kind.key())
        .fetch_all(&mut *tx)
        .await
        .map_err(|_| "读取源失败")?;
    if ids.len() != source_ids.len()
        || ids.iter().collect::<HashSet<_>>() != source_ids.iter().collect::<HashSet<_>>()
    {
        return Err("排序列表必须包含全部源且不能重复".to_owned());
    }
    for (index, id) in source_ids.iter().enumerate() {
        sqlx::query("UPDATE sources SET sort = ? WHERE id = ?")
            .bind(index as i64)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(|_| "排序失败")?;
    }
    tx.commit().await.map_err(|_| "提交排序失败")?;
    notify(&app, kind);
    list(&db, kind).await
}

/// 交换点播源的主地址与选定备用地址
#[tauri::command]
pub async fn switch_source_backup(
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
    id: String,
    backup_url: String,
) -> Result<Source, String> {
    let source = find(&db, SourceKind::Vod, &id).await?;
    let mut backups = source.backups;
    let index = backups
        .iter()
        .position(|url| url == &backup_url)
        .ok_or("备用地址不存在")?;
    backups[index] = source.url;
    let input = SourceInput {
        name: source.name,
        url: backup_url,
        disabled: source.disabled,
        headers: source.headers,
        backups,
    };
    let result = save(&db, SourceKind::Vod, Some(id), input).await?;
    notify(&app, SourceKind::Vod);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    /// 主地址与备用地址冲突时整次修改失败，已有源保持不变
    #[tokio::test]
    async fn source_endpoint_uniqueness() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        let input = SourceInput {
            name: "test".into(),
            url: "https://example.test/api".into(),
            disabled: false,
            headers: BTreeMap::new(),
            backups: vec!["https://backup.test/api".into()],
        };
        let source = save(&db, SourceKind::Vod, None, input.clone())
            .await
            .unwrap();
        let mut duplicate = input.clone();
        duplicate.url = "https://backup.test/api".into();
        duplicate.backups.clear();
        assert!(save(&db, SourceKind::Vod, None, duplicate).await.is_err());
        assert_eq!(list(&db, SourceKind::Vod).await.unwrap().len(), 1);
        let mut updated = input;
        updated.name = "updated".into();
        let result = save(&db, SourceKind::Vod, Some(source.id.clone()), updated)
            .await
            .unwrap();
        assert_eq!(result.created_at, source.created_at);
        assert_eq!(result.name, "updated");
        db.close().await;
    }
}

#[derive(Serialize)]
struct InvalidImport {
    index: usize,
    reason: String,
    raw: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    valid_items: Vec<SourceInput>,
    invalid_items: Vec<InvalidImport>,
    new_items: Vec<SourceInput>,
    overwrite_items: Vec<SourceInput>,
    skipped_items: Vec<SourceInput>,
}

#[derive(Serialize)]
pub struct ImportResult {
    created: Vec<Source>,
    overwritten: Vec<Source>,
    skipped: Vec<SourceInput>,
    invalid: Vec<InvalidImport>,
}

/// 分类导入条目并保留无效条目的位置与原因
fn preview(kind: SourceKind, payload: serde_json::Value, existing: &[Source]) -> ImportPreview {
    let items = match payload {
        serde_json::Value::Array(items) => items,
        item => vec![item],
    };
    let mut result = ImportPreview {
        valid_items: vec![],
        invalid_items: vec![],
        new_items: vec![],
        overwrite_items: vec![],
        skipped_items: vec![],
    };
    let mut seen = HashSet::new();
    for (index, raw) in items.into_iter().enumerate() {
        match serde_json::from_value::<SourceInput>(raw.clone())
            .map_err(|_| "源字段格式无效".to_owned())
            .and_then(|input| normalize(input, kind))
        {
            Ok(item) => {
                result.valid_items.push(item.clone());
                if !seen.insert(item.url.clone()) {
                    result.skipped_items.push(item);
                } else if existing.iter().any(|source| source.url == item.url) {
                    result.overwrite_items.push(item);
                } else {
                    result.new_items.push(item);
                }
            }
            Err(reason) => result
                .invalid_items
                .push(InvalidImport { index, reason, raw }),
        }
    }
    result
}

/// 预览源列表导入，不修改数据库
#[tauri::command]
pub async fn preview_source_import(
    db: State<'_, SqlitePool>,
    kind: SourceKind,
    payload: serde_json::Value,
) -> Result<ImportPreview, String> {
    Ok(preview(kind, payload, &list(&db, kind).await?))
}

/// 批量导入使用同一事务，后续地址冲突会回滚本批次全部写入
async fn import(
    db: &SqlitePool,
    kind: SourceKind,
    payload: serde_json::Value,
) -> Result<ImportResult, String> {
    let mut tx = db.begin().await.map_err(|_| "无法开始导入")?;
    let existing: Vec<Source> =
        sqlx::query_as("SELECT * FROM sources WHERE kind=? ORDER BY sort,id")
            .bind(kind.key())
            .fetch_all(&mut *tx)
            .await
            .map_err(|_| "读取源失败")?;
    let preview = preview(kind, payload, &existing);
    let mut result = ImportResult {
        created: vec![],
        overwritten: vec![],
        skipped: preview.skipped_items,
        invalid: preview.invalid_items,
    };
    for item in preview.new_items.into_iter().chain(preview.overwrite_items) {
        let id = existing
            .iter()
            .find(|source| source.url == item.url)
            .map(|source| source.id.clone());
        let overwrite = id.is_some();
        let row = save_in_transaction(&mut tx, kind, id, item).await?;
        sqlx::query("UPDATE sources SET origin='manual' WHERE id=?")
            .bind(&row.id)
            .execute(&mut *tx)
            .await
            .map_err(|_| "更新源归属失败")?;
        let row = Source {
            origin: "manual".into(),
            ..row
        };
        if overwrite {
            result.overwritten.push(row);
        } else {
            result.created.push(row);
        }
    }
    tx.commit().await.map_err(|_| "提交导入失败")?;
    Ok(result)
}

/// 确认导入并通知窗口刷新
#[tauri::command]
pub async fn confirm_source_import(
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
    kind: SourceKind,
    payload: serde_json::Value,
) -> Result<ImportResult, String> {
    let result = import(&db, kind, payload).await?;
    notify(&app, kind);
    Ok(result)
}

/// 测量点播列表接口响应时间，限制超时并释放响应
#[tauri::command]
pub async fn test_source_speed(
    db: State<'_, SqlitePool>,
    id: String,
) -> Result<serde_json::Value, String> {
    let source = find(&db, SourceKind::Vod, &id).await?;
    let mut url = network::parse_http_url(&source.url)?;
    let params: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(key, _)| !matches!(key.as_ref(), "ac" | "pg"))
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    url.set_query(None);
    url.query_pairs_mut()
        .extend_pairs(params)
        .append_pair("ac", "list")
        .append_pair("pg", "1");
    let headers = network::source_headers(&url, &url, &source.headers)?;
    let client = network::create_client(&network::NetworkMode::Direct)?;
    let start = std::time::Instant::now();
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        network::request(&client, reqwest::Method::GET, url, headers),
    )
    .await;
    let error = match response {
        Ok(Ok(response)) if response.status().is_success() => None,
        Ok(Ok(response)) => Some(format!("HTTP {}", response.status().as_u16())),
        Ok(Err(error)) => Some(error),
        Err(_) => Some("请求超时".to_owned()),
    };
    Ok(match error {
        Some(error) => serde_json::json!({"status":"error","errorMessage":error}),
        None => {
            serde_json::json!({"status":"success","elapsedMs":start.elapsed().as_millis().max(1)})
        }
    })
}

#[cfg(test)]
mod import_tests {
    use super::*;
    /// 第二条与已有备用地址冲突时，第一条新增记录也必须回滚
    #[tokio::test]
    async fn batch_conflict_rolls_back_all_rows() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        import(&db,SourceKind::Vod,serde_json::json!({"name":"existing","url":"https://a.test/api","backups":["https://b.test/api"]})).await.unwrap();
        let result = import(&db,SourceKind::Vod,serde_json::json!([{"name":"new","url":"https://c.test/api"},{"name":"conflict","url":"https://b.test/api"}])).await;
        assert!(result.is_err());
        assert_eq!(list(&db, SourceKind::Vod).await.unwrap().len(), 1);
        db.close().await;
    }
}

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
    let mut tx = db.begin().await.map_err(|_| "无法开始订阅同步")?;
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM subscriptions WHERE id=? AND url=?)")
            .bind(id)
            .bind(url)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| "读取订阅失败")?;
    if !exists {
        return Err("订阅已被删除或修改，请重试".into());
    }
    sqlx::query("DELETE FROM sources WHERE origin='subscription'")
        .execute(&mut *tx)
        .await
        .map_err(|_| "更新订阅源失败")?;
    let mut counts = Vec::new();
    for (kind, items) in [
        (SourceKind::Vod, payload.vod),
        (SourceKind::Iptv, payload.iptv),
    ] {
        let mut positions = std::collections::HashMap::new();
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
        counts.push(unique.len());
        for item in unique {
            let row = save_in_transaction(&mut tx, kind, None, item).await?;
            sqlx::query("UPDATE sources SET origin='subscription' WHERE id=?")
                .bind(row.id)
                .execute(&mut *tx)
                .await
                .map_err(|_| "保存订阅来源失败")?;
        }
    }
    sqlx::query("INSERT INTO app_settings(key,value) VALUES('activeSubscriptionId',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(serde_json::json!(id).to_string()).execute(&mut *tx).await.map_err(|_| "保存当前订阅失败")?;
    let now: i64 = sqlx::query_scalar("SELECT CAST(unixepoch('subsec')*1000 AS INTEGER)")
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| "读取同步时间失败")?;
    tx.commit().await.map_err(|_| "提交订阅失败")?;
    Ok(
        serde_json::json!({"vod":{"created":counts[0],"updated":0,"unchanged":0},"iptv":{"created":counts[1],"updated":0,"unchanged":0},"updatedAt":now}),
    )
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
        .map_err(|_| "读取订阅失败")?
        .ok_or("订阅不存在")?;
    let client = network::create_client(&mode)?;
    let bytes = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        let mut response = network::request(
            &client,
            reqwest::Method::GET,
            network::parse_http_url(&url)?,
            Default::default(),
        )
        .await?;
        if !response.status().is_success() {
            return Err(format!("订阅返回 HTTP {}", response.status().as_u16()));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "读取订阅失败")? {
            if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
                return Err("订阅超过 2 MiB 限制".to_owned());
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    })
    .await
    .map_err(|_| "订阅下载超时")??;
    let payload =
        tauri::async_runtime::spawn_blocking(move || -> Result<SubscriptionPayload, String> {
            let encoded = String::from_utf8(bytes).map_err(|_| "订阅编码无效")?;
            let decoded = bs58::decode(encoded.trim())
                .into_vec()
                .map_err(|_| "订阅不是有效的 Base58 内容")?;
            serde_json::from_slice(&decoded).map_err(|_| "订阅 JSON 格式无效".to_owned())
        })
        .await
        .map_err(|_| "订阅解码任务失败")??;
    let result = apply_subscription(&db, &subscription_id, &url, payload).await?;
    if let Err(error) = app.emit("app-data-changed", "app-data") {
        log::warn!("订阅通知失败: {error}");
    }
    Ok(result)
}

/// 删除订阅；删除当前订阅时同时清除其源数据
#[tauri::command]
pub async fn delete_source_subscription(
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
    subscription_id: String,
) -> Result<(), String> {
    let mut tx = db.begin().await.map_err(|_| "无法删除订阅")?;
    let deleted = sqlx::query("DELETE FROM subscriptions WHERE id=?")
        .bind(&subscription_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| "删除订阅失败")?;
    if deleted.rows_affected() == 0 {
        return Err("订阅不存在".into());
    }
    let active: Option<String> = sqlx::query_scalar(
        "SELECT json_extract(value,'$') FROM app_settings WHERE key='activeSubscriptionId'",
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| "读取当前订阅失败")?
    .flatten();
    if active.as_deref() == Some(&subscription_id) {
        sqlx::query("DELETE FROM sources WHERE origin='subscription'")
            .execute(&mut *tx)
            .await
            .map_err(|_| "删除订阅源失败")?;
        sqlx::query("UPDATE app_settings SET value=COALESCE((SELECT json_quote(id) FROM subscriptions ORDER BY sort,id LIMIT 1),'null') WHERE key='activeSubscriptionId'").execute(&mut *tx).await.map_err(|_| "更新当前订阅失败")?;
    }
    tx.commit().await.map_err(|_| "提交删除失败")?;
    if let Err(error) = app.emit("app-data-changed", "app-data") {
        log::warn!("订阅通知失败: {error}");
    }
    Ok(())
}

/// 由用户选择源文件，取消时不修改数据库
#[tauri::command]
pub async fn import_sources_from_file(
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
    kind: SourceKind,
) -> Result<serde_json::Value, String> {
    use tauri_plugin_dialog::DialogExt;
    let dialog_app = app.clone();
    let file = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .add_filter("JSON", &["json"])
            .blocking_pick_file()
    })
    .await
    .map_err(|_| "打开文件对话框失败")?;
    let Some(file) = file else {
        return Ok(
            serde_json::json!({"cancelled":true,"created":[],"overwritten":[],"skipped":[],"invalid":[]}),
        );
    };
    let path = file.into_path().map_err(|_| "请选择本地文件")?;
    if tokio::fs::metadata(&path)
        .await
        .map_err(|_| "无法读取文件信息")?
        .len()
        > 8 * 1024 * 1024
    {
        return Err("源文件超过 8 MiB 限制".into());
    }
    let bytes = tokio::fs::read(&path).await.map_err(|_| "读取源文件失败")?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("源文件超过 8 MiB 限制".into());
    }
    let payload = serde_json::from_slice(&bytes).map_err(|_| "源文件不是有效 JSON")?;
    let result = import(&db, kind, payload).await?;
    notify(&app, kind);
    let mut value = serde_json::to_value(result).map_err(|_| "生成导入结果失败")?;
    value["cancelled"] = false.into();
    value["filePath"] = path.to_string_lossy().to_string().into();
    Ok(value)
}

/// 导出可分享的源定义，排除内部标识与数据库元数据
#[tauri::command]
pub async fn export_sources_to_file(
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
    kind: SourceKind,
) -> Result<serde_json::Value, String> {
    use tauri_plugin_dialog::DialogExt;
    let rows = list(&db, kind).await?;
    let items: Vec<_> = rows.into_iter().map(|row| {
        let mut value = serde_json::json!({"name":row.name,"url":row.url,"disabled":row.disabled,"headers":row.headers});
        if matches!(kind,SourceKind::Vod) { value["backups"]=serde_json::json!(row.backups); }
        value
    }).collect();
    let bytes = serde_json::to_vec_pretty(&items).map_err(|_| "生成源文件失败")?;
    let file = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("JSON", &["json"])
            .set_file_name(format!("{}-sources.json", kind.key()))
            .blocking_save_file()
    })
    .await
    .map_err(|_| "打开保存对话框失败")?;
    let Some(file) = file else {
        return Ok(serde_json::json!({"cancelled":true,"count":0}));
    };
    let path = file.into_path().map_err(|_| "请选择本地文件")?;
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|_| "保存源文件失败")?;
    Ok(serde_json::json!({"cancelled":false,"count":items.len(),"filePath":path.to_string_lossy()}))
}

#[cfg(test)]
mod subscription_tests {
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
        sqlx::query("INSERT INTO subscriptions VALUES('sub','https://sub.test/',0)")
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
        assert_eq!(
            list(&db, SourceKind::Iptv).await.unwrap()[0].origin,
            "manual"
        );
        db.close().await;
    }
}
