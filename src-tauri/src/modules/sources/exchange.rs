use super::repository::{
    list_in_transaction, normalize, validate_changes, write_source, SourceChange,
};
use super::{list, notify, Source, SourceInput, SourceKind};
use crate::infrastructure::diagnostics::command_error;
use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use tauri::State;

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
    let existing_urls: HashSet<&str> = existing.iter().map(|source| source.url.as_str()).collect();
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
                } else if existing_urls.contains(item.url.as_str()) {
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
pub(super) async fn import(
    db: &SqlitePool,
    kind: SourceKind,
    payload: serde_json::Value,
) -> Result<ImportResult, String> {
    let mut tx = db
        .begin()
        .await
        .map_err(|error| command_error("无法开始导入", &error))?;
    let existing = list_in_transaction(&mut tx, kind).await?;
    let preview = preview(kind, payload, &existing);
    let mut result = ImportResult {
        created: vec![],
        overwritten: vec![],
        skipped: preview.skipped_items,
        invalid: preview.invalid_items,
    };
    let by_url: HashMap<&str, &Source> = existing
        .iter()
        .map(|source| (source.url.as_str(), source))
        .collect();
    let changes: Vec<_> = preview
        .new_items
        .into_iter()
        .chain(preview.overwrite_items)
        .map(|input| SourceChange {
            existing: by_url.get(input.url.as_str()).copied(),
            input,
        })
        .collect();
    validate_changes(&existing, &changes, &HashSet::new())?;
    let mut next_sort = existing
        .iter()
        .map(|source| source.sort)
        .max()
        .map_or(0, |sort| sort + 1);
    for change in changes {
        // 文件导入的源统一改为手动归属
        let row = write_source(&mut tx, kind, &change, None, &mut next_sort).await?;
        if change.existing.is_some() {
            result.overwritten.push(row);
        } else {
            result.created.push(row);
        }
    }
    tx.commit()
        .await
        .map_err(|error| command_error("提交导入失败", &error))?;
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
    /// 批次校验覆盖新条目之间的备用地址冲突，失败不写入任何条目
    #[tokio::test]
    async fn batch_backup_collision_preserves_database() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        let payload = serde_json::json!([
            {"name":"A","url":"https://a.test/","backups":["https://shared.test/"]},
            {"name":"B","url":"https://b.test/","backups":["https://shared.test/"]}
        ]);
        assert!(import(&db, SourceKind::Vod, payload).await.is_err());
        assert!(list(&db, SourceKind::Vod).await.unwrap().is_empty());
        db.close().await;
    }

    /// 文件覆盖保留源 ID，同时解除订阅归属并允许批次内转移备用地址
    #[tokio::test]
    async fn batch_overwrite_preserves_identity_and_validates_final_addresses() {
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
        let first = import(&db,SourceKind::Vod,serde_json::json!({"name":"A","url":"https://a.test/","backups":["https://shared.test/"]})).await.unwrap();
        let id = &first.created[0].id;
        sqlx::query("UPDATE sources SET subscription_id='sub' WHERE id=?")
            .bind(id)
            .execute(&db)
            .await
            .unwrap();
        let result = import(
            &db,
            SourceKind::Vod,
            serde_json::json!([
                {"name":"B","url":"https://b.test/","backups":["https://shared.test/"]},
                {"name":"A updated","url":"https://a.test/"}
            ]),
        )
        .await
        .unwrap();
        assert_eq!(result.overwritten[0].id, *id);
        assert!(result.overwritten[0].subscription_id.is_none());
        sqlx::query("DELETE FROM subscriptions WHERE id='sub'")
            .execute(&db)
            .await
            .unwrap();
        assert_eq!(list(&db, SourceKind::Vod).await.unwrap().len(), 2);
        db.close().await;
    }
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
    .map_err(|error| command_error("打开文件对话框失败", &error))?;
    let Some(file) = file else {
        return Ok(
            serde_json::json!({"cancelled":true,"created":[],"overwritten":[],"skipped":[],"invalid":[]}),
        );
    };
    let path = file.into_path().map_err(|_| "请选择本地文件")?;
    if tokio::fs::metadata(&path)
        .await
        .map_err(|error| command_error("无法读取文件信息", &error))?
        .len()
        > 8 * 1024 * 1024
    {
        return Err("源文件超过 8 MiB 限制".into());
    }
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|error| command_error("读取源文件失败", &error))?;
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
    .map_err(|error| command_error("打开保存对话框失败", &error))?;
    let Some(file) = file else {
        return Ok(serde_json::json!({"cancelled":true,"count":0}));
    };
    let path = file.into_path().map_err(|_| "请选择本地文件")?;
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|error| command_error("保存源文件失败", &error))?;
    Ok(serde_json::json!({"cancelled":false,"count":items.len(),"filePath":path.to_string_lossy()}))
}
