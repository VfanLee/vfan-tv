use super::{find, SourceKind};
use crate::infrastructure::network;
use sqlx::SqlitePool;
use tauri::State;

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
