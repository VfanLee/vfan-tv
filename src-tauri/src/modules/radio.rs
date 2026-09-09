use crate::{
    infrastructure::media::{proxy::MediaProxy, types::StreamType},
    infrastructure::network,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

#[derive(Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Request {
    Categories,
    Regions,
    CategoryChannels {
        category_id: u64,
        page: u32,
        page_size: u32,
    },
    Detail {
        channel_id: u64,
    },
    Search {
        keyword: String,
        page: u32,
        page_size: u32,
    },
    Programs {
        channel_ids: Vec<u64>,
    },
    Billboard {
        category_id: u64,
        region_id: u64,
    },
}

/// 读取服务返回的数字或数字字符串
fn number(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
}
/// 读取非空文本
fn text(value: &Value) -> Option<&str> {
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}
/// 规范化电台分类与地区
fn category(value: &Value) -> Option<Value> {
    Some(json!({"id":number(&value["id"] )?,"title":text(&value["title"])?}))
}
/// 规范化电台频道，兼容搜索和详情两种响应
fn channel(value: &Value) -> Option<Value> {
    let mut result = json!({"id":number(&value["content_id"]).or_else(||number(&value["id"]))?,"title":text(&value["title"]).or_else(||text(&value["name"]))?});
    for (target, key) in [("coverUrl", "cover"), ("description", "description")] {
        if let Some(value) = text(&value[key]) {
            result[target] = value.into();
        }
    }
    if let Some(count) = number(&value["audience_count"]) {
        result["audienceCount"] = count.into();
    }
    if let Some(category) = category(&value["categories"][0]).or_else(|| {
        category(&json!({"id":value["top_category_id"],"title":value["top_category_title"]}))
    }) {
        result["category"] = category;
    }
    if let Some(region) = category(&value["region"]) {
        result["region"] = region;
    }
    if let Some(title) =
        text(&value["nowplaying"]["title"]).or_else(|| text(&value["nowplaying"]["name"]))
    {
        result["nowPlayingTitle"] = title.into();
    }
    Some(result)
}
/// 解析电台服务的两种成功封装
fn payload(value: Value) -> Result<Value, String> {
    if value["Success"] == "ok" {
        return Ok(value["Data"].clone());
    }
    if number(&value["errcode"]) == Some(0) {
        return Ok(value["data"].clone());
    }
    Err(text(&value["Error"])
        .or_else(|| text(&value["errmsg"]))
        .unwrap_or("电台服务返回无效数据")
        .to_owned())
}
/// 请求固定的电台 API，限制总时间及响应大小
async fn get(url: reqwest::Url) -> Result<Value, String> {
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        let client = network::create_client(&network::NetworkMode::Direct)?;
        let mut response =
            network::request(&client, reqwest::Method::GET, url, Default::default()).await?;
        if !response.status().is_success() {
            return Err(format!("电台 API 返回 HTTP {}", response.status().as_u16()));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "读取电台数据失败")? {
            if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
                return Err("电台响应过大".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        payload(serde_json::from_slice(&bytes).map_err(|_| "电台响应不是有效 JSON")?)
    })
    .await
    .map_err(|_| "电台请求超时".to_owned())?
}
/// 请求分类、频道、搜索、节目和地区数据
#[tauri::command]
pub async fn radio_request(input: Request) -> Result<Value, String> {
    let url = match &input {
        Request::Categories => "https://rapi.qtfm.cn/categories?type=channel".into(),
        Request::Regions => "https://rapi.qtfm.cn/regions?all=true".into(),
        Request::CategoryChannels {
            category_id,
            page,
            page_size,
        } => format!(
            "https://rapi.qtfm.cn/categories/{category_id}/channels?page={}&pagesize={}",
            page.max(&1),
            page_size.clamp(&1, &50)
        ),
        Request::Detail { channel_id } => {
            format!("https://rapi.qingting.fm/v4/channels/{channel_id}")
        }
        Request::Billboard {
            category_id,
            region_id,
        } => format!("https://rapi.qtfm.cn/billboards/{category_id}/{region_id}/channels"),
        Request::Search {
            keyword,
            page,
            page_size,
        } => {
            if keyword.trim().is_empty() {
                return Ok(json!({"items":[],"hasMore":false}));
            }
            if keyword.chars().count() > 1000 {
                return Err("搜索词过长".into());
            }
            let mut url = network::parse_http_url("https://search.qingting.fm/v3/search")?;
            url.query_pairs_mut()
                .append_pair("k", keyword.trim())
                .append_pair("page", &page.max(&1).to_string())
                .append_pair("pagesize", &page_size.clamp(&1, &50).to_string())
                .append_pair("include", "channel_live")
                .append_pair("k_src", "direct");
            url.into()
        }
        Request::Programs { channel_ids } => {
            if channel_ids.is_empty() {
                return Ok(json!([]));
            }
            if channel_ids.len() > 500 {
                return Err("单次节目查询超过 500 个频道".into());
            }
            let mut ids = channel_ids.clone();
            ids.retain(|id| *id > 0);
            ids.sort_unstable();
            ids.dedup();
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "系统时间无效")?
                .as_secs();
            format!(
                "https://rapi.qingting.fm/v2/livechannelplaying?ids={}&current_time={now}",
                ids.iter().map(u64::to_string).collect::<Vec<_>>().join(",")
            )
        }
    };
    let value = get(network::parse_http_url(&url)?).await?;
    Ok(match input {
        Request::Categories | Request::Regions => json!(value
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(category)
            .collect::<Vec<_>>()),
        Request::Detail { .. } => channel(&value).ok_or("未找到电台详情")?,
        Request::Search {
            page, page_size, ..
        } => {
            let items = value["data"]["docs"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(channel)
                .collect::<Vec<_>>();
            let has_more = number(&value["data"]["numFound"])
                .map(|total| u64::from(page.max(1)) * u64::from(page_size.clamp(1, 50)) < total)
                .unwrap_or(items.len() >= page_size.clamp(1, 50) as usize);
            json!({"items":items,"hasMore":has_more})
        }
        Request::Programs { .. } => json!(value
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|item| {
                let id = number(&item["id"])?;
                let mut result = json!({"channelId":id});
                if let Some(title) =
                    text(&item["program"]["title"]).or_else(|| text(&item["program"]["name"]))
                {
                    result["title"] = title.into();
                }
                Some(result)
            })
            .collect::<Vec<_>>()),
        _ => json!(value
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(channel)
            .collect::<Vec<_>>()),
    })
}
/// 创建固定直连电台会话，随切台和卸载释放
#[tauri::command]
pub async fn get_radio_playback_target(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    proxy: State<'_, MediaProxy>,
    channel_id: u64,
) -> Result<Value, String> {
    if channel_id == 0 {
        return Err("电台频道无效".into());
    }
    let url = network::parse_http_url(&format!(
        "https://ls.qingting.fm/live/{channel_id}/64k.m3u8"
    ))?;
    let client = network::create_client(&network::NetworkMode::Direct)?;
    let (src, id) = proxy
        .create(
            url,
            StreamType::Hls,
            client,
            "直连".into(),
            std::collections::BTreeMap::from([(
                "referer".into(),
                "https://ls.qingting.fm/".into(),
            )]),
        )
        .await?;
    crate::desktop::mini_window::track_radio(&app, &window, &id).await?;
    Ok(json!({"src":src,"mediaSessionId":id}))
}

#[cfg(test)]
mod tests {
    use super::*;
    /// 兼容服务封装和数字字符串，保留频道节目字段
    #[test]
    fn normalizes_radio_payloads() {
        let value=payload(json!({"errcode":"0","data":{"content_id":"42","name":"电台","categories":[{"id":"3","title":"新闻"}],"nowplaying":{"name":"节目"}}})).unwrap();
        let channel = channel(&value).unwrap();
        assert_eq!(channel["id"], 42);
        assert_eq!(channel["nowPlayingTitle"], "节目");
        assert_eq!(channel["category"]["id"], 3);
        assert_eq!(
            payload(json!({"Success":"ok","Data":[]})).unwrap(),
            json!([])
        );
        assert!(payload(json!({"errcode":1,"errmsg":"failed"})).is_err());
    }
}
