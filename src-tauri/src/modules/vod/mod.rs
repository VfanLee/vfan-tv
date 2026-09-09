mod api;
use crate::{
    infrastructure::network,
    modules::sources::{self, Source, SourceKind},
};
use futures_util::{stream, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::{collections::HashMap, sync::Arc};
use tauri::{Emitter, State};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct Searches(Arc<tokio::sync::Mutex<HashMap<String, (String, CancellationToken)>>>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogInput {
    source_id: String,
    page: u32,
    category_id: Option<String>,
    keyword: Option<String>,
}

/// 读取并校验当前启用的点播源
async fn enabled(db: &SqlitePool, id: &str) -> Result<Source, String> {
    let source = sources::find(db, SourceKind::Vod, id).await?;
    if source.disabled {
        return Err("点播源未启用".into());
    }
    Ok(source)
}

/// 读取目录并用批量详情补齐缺失海报
#[tauri::command]
pub async fn get_vod_catalog_page(
    db: State<'_, SqlitePool>,
    input: CatalogInput,
) -> Result<Value, String> {
    let source = enabled(&db, &input.source_id).await?;
    let client = network::create_client(&network::NetworkMode::Direct)?;
    let mut params = vec![("ac", "list".into()), ("pg", input.page.max(1).to_string())];
    for (key, value) in [("t", input.category_id), ("wd", input.keyword)] {
        if let Some(value) = value.filter(|value| !value.trim().is_empty()) {
            params.push((key, value.trim().into()));
        }
    }
    let response = api::request(&client, &source, &params).await?;
    let mut page = api::page(&response, &source);
    let items = page["items"].as_array_mut().ok_or("目录数据无效")?;
    let ids: Vec<String> = items
        .iter()
        .filter(|item| item.get("poster").is_none())
        .filter_map(|item| {
            item["vodId"]
                .as_str()
                .filter(|id| !id.is_empty())
                .map(String::from)
        })
        .collect();
    if let Ok(details) = api::details(&client, &source, &ids).await {
        for detail in details {
            if let Some(item) = items
                .iter_mut()
                .find(|item| item["vodId"] == detail["vodId"])
            {
                if let (Some(item), Some(detail)) = (item.as_object_mut(), detail.as_object()) {
                    item.extend(detail.clone());
                }
            }
        }
    }
    Ok(page)
}

/// 返回指定视频详情，避免将其他视频误当作目标
#[tauri::command]
pub async fn get_vod_detail(
    db: State<'_, SqlitePool>,
    source_id: String,
    vod_id: String,
) -> Result<Value, String> {
    if vod_id.trim().is_empty() {
        return Err("视频 ID 不能为空".into());
    }
    let source = enabled(&db, &source_id).await?;
    let client = network::create_client(&network::NetworkMode::Direct)?;
    api::details(&client, &source, &[vod_id.trim().into()])
        .await?
        .into_iter()
        .find(|item| item["vodId"] == vod_id.trim())
        .ok_or("未找到该视频详情".into())
}

/// 启动窗口所属的并发搜索，最多同时访问六个源
#[tauri::command]
pub async fn search_vod(
    window: tauri::WebviewWindow,
    db: State<'_, SqlitePool>,
    tasks: State<'_, Searches>,
    keyword: String,
    search_id: String,
) -> Result<Value, String> {
    let keyword = keyword.trim().to_owned();
    if keyword.is_empty()
        || keyword.chars().count() > 1000
        || uuid::Uuid::parse_str(&search_id).is_err()
    {
        return Err("搜索参数无效".into());
    }
    let sources = sources::list(&db, SourceKind::Vod)
        .await?
        .into_iter()
        .filter(|source| !source.disabled)
        .collect::<Vec<_>>();
    let client = network::create_client(&network::NetworkMode::Direct)?;
    let token = CancellationToken::new();
    let registry = tasks.0.clone();
    {
        let mut tasks = registry.lock().await;
        if tasks.contains_key(&search_id) {
            return Err("搜索标识已存在".into());
        }
        for (owner, task) in tasks.values() {
            if owner == window.label() {
                task.cancel();
            }
        }
        if tasks.len() >= 16 {
            return Err("搜索任务过多，请稍后重试".into());
        }
        tasks.insert(search_id.clone(), (window.label().into(), token.clone()));
    }
    let id = search_id.clone();
    tauri::async_runtime::spawn(async move {
        stream::iter(sources).map(|source|{
            let token=token.clone();let window=window.clone();let client=client.clone();let keyword=keyword.clone();let id=id.clone();
            async move {
                let mut event=json!({"searchId":id,"sourceId":source.id,"sourceName":source.name});
                if !token.is_cancelled(){event["type"]="source-start".into();if window.emit("vod-search-event",&event).is_err(){token.cancel();}}
                let result=tokio::select! {
                    biased;
                    _=token.cancelled()=>Err("cancelled".to_owned()),
                    result=async {
                        let response=api::request(&client,&source,&[("ac","list".into()),("pg","1".into()),("wd",keyword)]).await?;
                        let summaries=api::items(&response,&source);
                        let mut ids=Vec::new();
                        for item in &summaries {if let Some(id)=item["vodId"].as_str().filter(|id|!id.is_empty()) {if !ids.iter().any(|existing|existing==id){ids.push(id.to_owned());}}}
                        api::details(&client,&source,&ids).await
                    }=>result,
                };
                match result {
                    Ok(items)=>{event["type"]="source-result".into();event["items"]=json!(items);},
                    Err(error)=>{event["type"]=if token.is_cancelled(){"source-cancelled"}else if error.contains("超时"){"source-timeout"}else{"source-error"}.into();event["message"]=error.into();},
                }
                let _=window.emit("vod-search-event",event);
            }
        }).buffer_unordered(6).collect::<Vec<_>>().await;
        let _ = window.emit("vod-search-event", json!({"type":"done","searchId":id}));
        registry.lock().await.remove(&id);
    });
    Ok(json!({"searchId":search_id}))
}

/// 仅取消当前窗口创建的搜索任务
#[tauri::command]
pub async fn cancel_vod_search(
    window: tauri::WebviewWindow,
    tasks: State<'_, Searches>,
    search_id: String,
) -> Result<(), String> {
    if let Some((owner, token)) = tasks.0.lock().await.get(&search_id) {
        if owner != window.label() {
            return Err("搜索任务不属于当前窗口".into());
        }
        token.cancel();
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeInput {
    source_id: String,
    url: String,
}

/// 探测媒体响应延迟与 HLS 主清单最高分辨率
#[tauri::command]
pub async fn probe_media_source(
    db: State<'_, SqlitePool>,
    input: ProbeInput,
) -> Result<Value, String> {
    let source = enabled(&db, &input.source_id).await?;
    let client = network::create_client(&network::NetworkMode::Direct)?;
    let start = std::time::Instant::now();
    let result = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let url = network::parse_http_url(&input.url)?;
        let headers = network::source_headers(
            &network::parse_http_url(&source.url)?,
            &url,
            &source.headers,
        )?;
        let mut response = network::request(&client, reqwest::Method::GET, url, headers).await?;
        if !response.status().is_success() {
            return Err("媒体源不可用".to_owned());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "读取媒体失败")? {
            let remaining = (2 * 1024 * 1024 - bytes.len()).min(chunk.len());
            bytes.extend_from_slice(&chunk[..remaining]);
            if bytes.len() >= 2 * 1024 * 1024 {
                break;
            }
        }
        static RESOLUTION: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
            regex::Regex::new(r"(?i)RESOLUTION=\d+x(\d+)").expect("固定分辨率表达式有效")
        });
        let quality = RESOLUTION
            .captures_iter(&String::from_utf8_lossy(&bytes))
            .filter_map(|captures| captures[1].parse::<u32>().ok())
            .filter(|height| *height > 0)
            .max()
            .map(|height| format!("{height}P"));
        Ok(json!({"latencyMs":start.elapsed().as_millis().max(1),"quality":quality}))
    })
    .await;
    Ok(match result {
        Ok(Ok(value)) => value,
        _ => json!({"latencyMs":null,"quality":null}),
    })
}

impl Searches {
    /// 窗口销毁时取消其尚未完成的上游请求
    pub async fn cancel_window(&self, label: &str) {
        for (owner, token) in self.0.lock().await.values() {
            if owner == label {
                token.cancel();
            }
        }
    }
}
