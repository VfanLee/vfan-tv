use super::repository::save;
use super::{find, list, notify, notify_selections, Source, SourceInput, SourceKind};
use crate::infrastructure::diagnostics::command_error;
use sqlx::SqlitePool;
use std::collections::HashSet;
use tauri::State;

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
        .map_err(|error| command_error("删除源失败", &error))?;
    if id.is_some() && result.rows_affected() == 0 {
        return Err("数据源不存在".to_owned());
    }
    notify(&app, kind);
    notify_selections(&app);
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
    let mut tx = db
        .begin()
        .await
        .map_err(|error| command_error("无法开始排序", &error))?;
    let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM sources WHERE kind = ?")
        .bind(kind.key())
        .fetch_all(&mut *tx)
        .await
        .map_err(|error| command_error("读取源失败", &error))?;
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
            .map_err(|error| command_error("排序失败", &error))?;
    }
    tx.commit()
        .await
        .map_err(|error| command_error("提交排序失败", &error))?;
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
