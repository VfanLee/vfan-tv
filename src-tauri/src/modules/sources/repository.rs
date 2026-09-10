use super::{Source, SourceInput, SourceKind};
use crate::infrastructure::{diagnostics::command_error, network};
use sqlx::SqlitePool;
#[cfg(test)]
use std::collections::BTreeMap;
use std::collections::HashSet;
use uuid::Uuid;

/// 规范化源地址与请求头，不改变来源域的凭据语义
pub(super) fn normalize(mut input: SourceInput, kind: SourceKind) -> Result<SourceInput, String> {
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
        .map_err(|error| command_error("读取源列表失败", &error))
}

/// 查找指定类别中的源
pub async fn find(db: &SqlitePool, kind: SourceKind, id: &str) -> Result<Source, String> {
    sqlx::query_as("SELECT * FROM sources WHERE kind = ? AND id = ?")
        .bind(kind.key())
        .bind(id)
        .fetch_optional(db)
        .await
        .map_err(|error| command_error("读取源失败", &error))?
        .ok_or("数据源不存在".to_owned())
}

/// 批次中的规范化源内容及其已有记录
pub(super) struct SourceChange<'a> {
    pub(super) existing: Option<&'a Source>,
    pub(super) input: SourceInput,
}

impl SourceChange<'_> {
    /// 判断同步内容是否与已保存的源配置一致
    pub(super) fn unchanged(&self) -> bool {
        self.existing.is_some_and(|source| {
            source.name == self.input.name
                && source.url == self.input.url
                && source.disabled == self.input.disabled
                && source.headers == self.input.headers
                && source.backups == self.input.backups
        })
    }
}

/// 在事务中一次读取批量写入所需的源记录
pub(super) async fn list_in_transaction(
    connection: &mut sqlx::SqliteConnection,
    kind: SourceKind,
) -> Result<Vec<Source>, String> {
    sqlx::query_as("SELECT * FROM sources WHERE kind=? ORDER BY sort,id")
        .bind(kind.key())
        .fetch_all(connection)
        .await
        .map_err(|error| command_error("读取源列表失败", &error))
}

/// 校验批次完成后的全部地址，包含主地址与备用地址
pub(super) fn validate_changes(
    existing: &[Source],
    changes: &[SourceChange<'_>],
    removed: &HashSet<&str>,
) -> Result<(), String> {
    let replaced: HashSet<&str> = changes
        .iter()
        .filter_map(|change| change.existing.map(|source| source.id.as_str()))
        .chain(removed.iter().copied())
        .collect();
    let mut addresses = HashSet::new();
    for source in existing
        .iter()
        .filter(|source| !replaced.contains(source.id.as_str()))
    {
        for url in std::iter::once(&source.url).chain(&source.backups) {
            addresses.insert(url.as_str());
        }
    }
    for change in changes {
        for url in std::iter::once(&change.input.url).chain(&change.input.backups) {
            if !addresses.insert(url.as_str()) {
                return Err("源地址或备用地址已被其他源使用".to_owned());
            }
        }
    }
    Ok(())
}

/// 写入已通过批次校验的源，保留已有记录的标识、排序和创建时间
pub(super) async fn write_source(
    connection: &mut sqlx::SqliteConnection,
    kind: SourceKind,
    change: &SourceChange<'_>,
    subscription_id: Option<&str>,
    next_sort: &mut i64,
) -> Result<Source, String> {
    let (id, sort) = match change.existing {
        Some(source) => (source.id.clone(), source.sort),
        None => {
            let sort = *next_sort;
            *next_sort += 1;
            (Uuid::new_v4().to_string(), sort)
        }
    };
    let input = &change.input;
    sqlx::query_as("INSERT INTO sources (id,kind,name,url,disabled,headers,backups,sort,subscription_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER),CAST(unixepoch('subsec')*1000 AS INTEGER)) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,disabled=excluded.disabled,headers=excluded.headers,backups=excluded.backups,subscription_id=excluded.subscription_id,updated_at=excluded.updated_at RETURNING *")
        .bind(id).bind(kind.key()).bind(&input.name).bind(&input.url).bind(input.disabled)
        .bind(sqlx::types::Json(&input.headers)).bind(sqlx::types::Json(&input.backups))
        .bind(sort).bind(subscription_id)
        .fetch_one(connection).await.map_err(|error| command_error("保存源失败", &error))
}

/// 在事务中校验地址唯一性并新增或更新源
pub(super) async fn save(
    db: &SqlitePool,
    kind: SourceKind,
    id: Option<String>,
    input: SourceInput,
) -> Result<Source, String> {
    let input = normalize(input, kind)?;
    let mut tx = db
        .begin()
        .await
        .map_err(|error| command_error("无法开始源修改", &error))?;
    let existing = list_in_transaction(&mut tx, kind).await?;
    let source = match id {
        Some(id) => Some(
            existing
                .iter()
                .find(|source| source.id == id)
                .ok_or("数据源不存在")?,
        ),
        None => None,
    };
    let change = SourceChange {
        existing: source,
        input,
    };
    validate_changes(&existing, std::slice::from_ref(&change), &HashSet::new())?;
    let mut next_sort = existing
        .iter()
        .map(|source| source.sort)
        .max()
        .map_or(0, |sort| sort + 1);
    let row = write_source(
        &mut tx,
        kind,
        &change,
        source.and_then(|source| source.subscription_id.as_deref()),
        &mut next_sort,
    )
    .await?;
    tx.commit()
        .await
        .map_err(|error| command_error("提交源修改失败", &error))?;
    Ok(row)
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
