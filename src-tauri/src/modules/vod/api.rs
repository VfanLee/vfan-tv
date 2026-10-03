use crate::{infrastructure::network, modules::sources::Source};
use reqwest::Url;
use serde_json::{json, Value};
use std::sync::LazyLock;

/// 将 CMS 的字符串、数字或布尔值规范化为文本
fn text(value: &Value) -> String {
    match value {
        Value::String(value) => value.trim().to_owned(),
        Value::Number(_) | Value::Bool(_) => value.to_string(),
        _ => String::new(),
    }
}

/// 删除简介中的 HTML 标签，保持与现有展示格式一致
fn description(value: &Value) -> String {
    static TAGS: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new("<[^>]*>").expect("固定标签表达式有效"));
    TAGS.replace_all(&text(value), "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// 规范化视频条目并保留原始播放数据
pub fn items(payload: &Value, source: &Source) -> Vec<Value> {
    payload["list"].as_array().into_iter().flatten().filter_map(|raw| {
        if !raw.is_object() {return None;}
        let title = text(&raw["vod_name"]);
        if title.is_empty() {return None;}
        let mut item=json!({"sourceId":source.id,"sourceName":source.name,"sourceUrl":source.url,"vodId":text(&raw["vod_id"]),"title":title,"raw":raw,"rawJson":raw.to_string()});
        for (target,key) in [("subtitle","vod_sub"),("poster","vod_pic"),("year","vod_year"),("area","vod_area"),("language","vod_lang"),("remarks","vod_remarks"),("actor","vod_actor"),("director","vod_director")] {
            let value=text(&raw[key]); if !value.is_empty() {item[target]=value.into();}
        }
        let category=text(&raw["type_name"]); let category=if category.is_empty(){text(&raw["vod_class"])}else{category};
        if !category.is_empty(){item["category"]=category.into();}
        let description=description(&raw["vod_content"]); if !description.is_empty(){item["description"]=description.into();}
        Some(item)
    }).collect()
}

/// 更新 CMS 请求参数，保留用户配置中的认证参数
pub fn url(source: &Source, params: &[(&str, String)]) -> Result<Url, String> {
    let mut url = network::parse_http_url(&source.url)?;
    let retained: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(key, _)| !params.iter().any(|(name, _)| key == *name))
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    url.set_query(None);
    url.query_pairs_mut()
        .extend_pairs(retained)
        .extend_pairs(params.iter().map(|(key, value)| (*key, value)));
    Ok(url)
}

/// 下载 CMS JSON，限制总耗时和响应大小，错误不伪装成空结果
pub async fn request(
    client: &reqwest::Client,
    source: &Source,
    params: &[(&str, String)],
) -> Result<Value, String> {
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        let url = url(source, params)?;
        let headers = network::source_headers(
            &network::parse_http_url(&source.url)?,
            &url,
            &source.headers,
        )?;
        let response = network::request(client, reqwest::Method::GET, url, headers).await?;
        if !response.status().is_success() {
            return Err(format!("点播源返回 HTTP {}", response.status().as_u16()));
        }
        let bytes = network::read_limited(response, 16 * 1024 * 1024)
            .await
            .map_err(|error| match error {
                network::BodyReadError::Read(error) => {
                    log::warn!("读取点播数据失败: {error}");
                    "读取点播数据失败".to_owned()
                }
                network::BodyReadError::TooLarge => "点播响应超过 16 MiB 限制".to_owned(),
            })?;
        let value: Value =
            serde_json::from_slice(&bytes).map_err(|_| "点播源返回的不是有效 JSON")?;
        if !value["list"].is_array() {
            return Err("点播源缺少视频列表".into());
        }
        Ok(value)
    })
    .await
    .map_err(|_| "点播请求超时".to_owned())?
}

/// 读取非负分页数值，缺失或无效时回退默认值
fn number(value: &Value, fallback: f64) -> f64 {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
        .filter(|value| value.is_finite() && *value >= 0.0)
        .unwrap_or(fallback)
}

/// 规范化分类与分页信息
pub fn page(payload: &Value, source: &Source) -> Value {
    let mut categories: Vec<Value> = Vec::new();
    for raw in payload["class"].as_array().into_iter().flatten() {
        let id = text(&raw["type_id"]);
        let name = text(&raw["type_name"]);
        if id.is_empty() || name.is_empty() {
            continue;
        }
        let parent = text(&raw["type_pid"]);
        let category =
            json!({"id":id,"name":name,"parentId":if parent.is_empty(){"0".into()}else{parent}});
        if let Some(existing) = categories.iter_mut().find(|item| item["id"] == id) {
            *existing = category;
        } else {
            categories.push(category);
        }
    }
    json!({"categories":categories,"items":items(payload,source),"page":number(&payload["page"],1.0),"pageCount":number(&payload["pagecount"],1.0),"pageSize":number(&payload["limit"],0.0),"total":number(&payload["total"],0.0)})
}

/// 批量查询详情，每组最多 50 个 ID
pub async fn details(
    client: &reqwest::Client,
    source: &Source,
    ids: &[String],
) -> Result<Vec<Value>, String> {
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        let mut result = Vec::new();
        for ids in ids.chunks(50) {
            let payload = request(
                client,
                source,
                &[("ac", "detail".into()), ("ids", ids.join(","))],
            )
            .await?;
            result.extend(items(&payload, source));
        }
        Ok(result)
    })
    .await
    .map_err(|_| "点播详情请求超时".to_owned())?
}
