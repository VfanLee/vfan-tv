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

#[cfg(test)]
mod tests {
    use super::*;
    /// 构造与源仓储契约相同的测试配置
    fn source(url: &str) -> Source {
        Source {
            id: "source".into(),
            name: "Source".into(),
            url: url.into(),
            disabled: false,
            headers: Default::default(),
            backups: vec![],
            sort: 0,
            subscription_id: None,
            remark: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    /// 保留认证参数，替换分页参数，兼容数字 ID 与原始播放字段
    #[test]
    fn normalizes_cms_payload_and_parameters() {
        let source = source("https://source.test/api?token=abc&ac=old&pg=3");
        let url = url(
            &source,
            &[
                ("ac", "list".into()),
                ("pg", "1".into()),
                ("wd", "电影 & 剧集".into()),
            ],
        )
        .unwrap();
        let params: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert_eq!(params["token"], "abc");
        assert_eq!(params["ac"], "list");
        assert_eq!(params["wd"], "电影 & 剧集");
        let payload = json!({"page":"2","pagecount":"4","total":12,"class":[{"type_id":1,"type_name":"电影","type_pid":0}],"list":[{"vod_id":42,"vod_name":"Title","vod_content":"<p>Hello</p>  world","vod_play_url":"第1集$https://media.test/1.m3u8"},{"vod_name":" "}]});
        let page = page(&payload, &source);
        assert_eq!(page["page"], 2.0);
        assert_eq!(page["categories"][0]["id"], "1");
        assert_eq!(page["items"].as_array().unwrap().len(), 1);
        assert_eq!(page["items"][0]["vodId"], "42");
        assert_eq!(page["items"][0]["description"], "Hello world");
        assert_eq!(
            page["items"][0]["raw"]["vod_play_url"],
            payload["list"][0]["vod_play_url"]
        );
    }

    /// 模拟 CMS 服务，验证实际请求参数、请求头和批量详情解析
    #[tokio::test]
    async fn requests_catalog_and_detail_from_mock_cms() {
        use axum::{extract::Query, http::HeaderMap, routing::get, Json, Router};
        let router=Router::new().route("/api",get(|Query(params):Query<std::collections::HashMap<String,String>>,headers:HeaderMap|async move {
            assert_eq!(params.get("token").map(String::as_str),Some("secret"));
            assert_eq!(headers.get("x-source").unwrap(),"configured");
            if params.get("ac").map(String::as_str)==Some("detail") {
                assert_eq!(params.get("ids").map(String::as_str),Some("7"));
                Json(json!({"list":[{"vod_id":7,"vod_name":"Detail","vod_pic":"https://poster.test/7.jpg","vod_play_url":"1$https://video.test/7.mp4"}]}))
            }else{Json(json!({"page":1,"list":[{"vod_id":7,"vod_name":"Summary"}]}))}
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let mut source = source(&format!("http://{address}/api?token=secret"));
        source
            .headers
            .insert("X-Source".into(), "configured".into());
        let client = network::create_client(&network::NetworkMode::Direct).unwrap();
        let payload = request(&client, &source, &[("ac", "list".into())])
            .await
            .unwrap();
        assert_eq!(items(&payload, &source)[0]["title"], "Summary");
        let detail = details(&client, &source, &["7".into()]).await.unwrap();
        assert_eq!(detail[0]["title"], "Detail");
        assert!(detail[0]["poster"].is_string());
        server.abort();
        let _ = server.await;
    }

    /// 搜索详情保留首次出现顺序，重复 ID 不会扩大请求，空结果不请求详情
    #[tokio::test]
    async fn search_deduplicates_ids_and_skips_empty_details() {
        use axum::{extract::Query, routing::get, Json, Router};
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };
        let requests = Arc::new(AtomicUsize::new(0));
        let counter = requests.clone();
        let router = Router::new().route("/api", get(move |Query(params): Query<std::collections::HashMap<String, String>>| {
            let counter = counter.clone();
            async move {
                counter.fetch_add(1, Ordering::SeqCst);
                if params["ac"] == "detail" {
                    assert_eq!(params["ids"], "9,7");
                    Json(json!({"list": [{"vod_id":9,"vod_name":"Detail"},{"vod_id":7,"vod_name":"Other"}]}))
                } else if params["wd"] == "empty" {
                    Json(json!({"list": []}))
                } else {
                    assert_eq!(params["wd"], "电影 & 剧集");
                    Json(json!({"list": [{"vod_id":9,"vod_name":"First"},{"vod_id":7,"vod_name":"Second"},{"vod_id":9,"vod_name":"Duplicate"}]}))
                }
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let source = source(&format!("http://{}/api", listener.local_addr().unwrap()));
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let client = network::create_client(&network::NetworkMode::Direct).unwrap();
        let items = super::super::search_items(&client, &source, "电影 & 剧集")
            .await
            .unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["title"], "Detail");
        assert!(super::super::search_items(&client, &source, "empty")
            .await
            .unwrap()
            .is_empty());
        assert_eq!(requests.load(Ordering::SeqCst), 3);
        server.abort();
        let _ = server.await;
    }
}
