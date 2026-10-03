use crate::{infrastructure::network, modules::library};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::{
    collections::HashMap,
    sync::{Arc, Weak},
    time::Duration,
};
use tauri::State;
use tokio::sync::{Mutex, OnceCell};

type Page = OnceCell<Result<Value, String>>;

/// 仅合并同时进行的相同请求，完成后不保留推荐数据
#[derive(Default)]
pub struct Recommendations(Mutex<HashMap<String, Weak<Page>>>);

#[derive(Deserialize)]
pub struct Request {
    category: String,
    #[serde(rename = "type")]
    kind: String,
    start: i64,
    limit: i64,
}

/// 校验分类筛选组合并构建固定上游请求
fn endpoint(input: &Request) -> Result<(reqwest::Url, &'static str), String> {
    let (path, category, types): (_, _, &[&str]) = match input.category.as_str() {
        "movie" => ("movie", "热门", &["全部", "华语", "欧美", "韩国", "日本"]),
        "tv" => (
            "tv",
            "tv",
            &["tv_domestic", "tv_american", "tv_japanese", "tv_korean"],
        ),
        "animation" => ("tv", "tv", &["tv_animation"]),
        "documentary" => ("tv", "tv", &["tv_documentary"]),
        "show" => ("tv", "show", &["show", "show_domestic", "show_foreign"]),
        _ => return Err("不支持的推荐分类".into()),
    };
    if !types.contains(&input.kind.as_str()) {
        return Err("推荐分类与筛选项不匹配".into());
    }
    let mut url = network::parse_http_url(&format!(
        "https://m.douban.com/rexxar/api/v2/subject/recent_hot/{path}"
    ))?;
    url.query_pairs_mut()
        .append_pair("start", &input.start.max(0).to_string())
        .append_pair("limit", &input.limit.clamp(1, 50).to_string())
        .append_pair("category", category)
        .append_pair("type", &input.kind);
    Ok((
        url,
        if path == "movie" {
            "https://movie.douban.com/explore"
        } else {
            "https://movie.douban.com/tv/"
        },
    ))
}

/// 读取上游标量文本
fn text(value: &Value) -> String {
    match value {
        Value::String(value) => value.trim().to_owned(),
        Value::Number(_) | Value::Bool(_) => value.to_string(),
        _ => String::new(),
    }
}

/// 保留推荐展示字段与原始详情，分页位置按上游项目数推进
fn normalize(value: Value, input: &Request) -> Result<Value, String> {
    let rows = value["items"].as_array().ok_or("推荐响应缺少列表")?;
    let items = rows.iter().filter(|item| item.is_object()).map(|item| {
        let mut result = json!({"id":text(&item["id"]),"title":text(&item["title"]),"isNew":item["is_new"] == true,"category":input.category,"raw":item});
        for (key, first, second) in [
            ("subtitle", &item["card_subtitle"], &item["episodes_info"]),
            ("poster", &item["pic"]["large"], &item["pic"]["normal"]),
        ] {
            let first = text(first);
            let value = if first.is_empty() { text(second) } else { first };
            if !value.is_empty() { result[key] = value.into(); }
        }
        for (key, source) in [("rating", "value"), ("ratingStarCount", "star_count")] {
            if item["rating"][source].is_number() { result[key] = item["rating"][source].clone(); }
        }
        result
    }).collect::<Vec<_>>();
    let start = input.start.max(0);
    let limit = input.limit.clamp(1, 50);
    Ok(
        json!({"items":items,"start":start,"limit":limit,"nextStart":start.saturating_add(rows.len() as i64),"hasMore":rows.len() >= limit as usize}),
    )
}

/// 下载推荐页并限制整体耗时与响应体大小
async fn fetch(url: reqwest::Url, referer: &str, input: &Request) -> Result<Value, String> {
    tokio::time::timeout(Duration::from_secs(12), async {
        let client = network::create_client(&network::NetworkMode::Direct)?;
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::REFERER,
            referer.parse().map_err(|_| "推荐来源地址无效")?,
        );
        let response = network::request(&client, reqwest::Method::GET, url, headers).await?;
        if !response.status().is_success() {
            return Err(format!("推荐服务返回 HTTP {}", response.status().as_u16()));
        }
        let bytes = network::read_limited(response, 5 * 1024 * 1024)
            .await
            .map_err(|error| match error {
                network::BodyReadError::Read(error) => {
                    log::warn!("读取推荐响应失败: {error}");
                    "读取推荐响应失败".to_owned()
                }
                network::BodyReadError::TooLarge => "推荐响应过大".to_owned(),
            })?;
        normalize(
            serde_json::from_slice(&bytes).map_err(|_| "推荐响应不是有效 JSON")?,
            input,
        )
    })
    .await
    .map_err(|_| "推荐请求超时".to_owned())?
}

impl Recommendations {
    /// 合并同页并发加载，失败或完成后允许后续请求重新加载
    async fn page(&self, input: Request) -> Result<Value, String> {
        let (url, referer) = endpoint(&input)?;
        let key = url.to_string();
        let cell = {
            let mut pending = self.0.lock().await;
            pending.retain(|_, cell| cell.strong_count() > 0);
            if let Some(cell) = pending.get(&key).and_then(Weak::upgrade) {
                cell
            } else {
                if pending.len() >= 64 {
                    return Err("推荐请求过多，请稍后重试".into());
                }
                let cell = Arc::new(OnceCell::new());
                pending.insert(key, Arc::downgrade(&cell));
                cell
            }
        };
        cell.get_or_init(|| fetch(url, referer, &input))
            .await
            .clone()
    }
}

/// 按原有分类和筛选项读取推荐分页
#[tauri::command]
pub async fn get_hot_recommendations(
    state: State<'_, Recommendations>,
    input: Request,
) -> Result<Value, String> {
    state.page(input).await
}

/// 聚合本地最近播放和独立加载的推荐分类
#[tauri::command]
pub async fn get_home_data(
    db: State<'_, SqlitePool>,
    state: State<'_, Recommendations>,
) -> Result<Value, String> {
    let requests = [
        ("movie", "全部"),
        ("tv", "tv_domestic"),
        ("animation", "tv_animation"),
        ("documentary", "tv_documentary"),
        ("show", "show"),
    ];
    let pages = futures_util::future::join_all(requests.into_iter().map(|(category, kind)| {
        state.page(Request {
            category: category.into(),
            kind: kind.into(),
            start: 0,
            limit: if category == "movie" { 12 } else { 8 },
        })
    }));
    let (recent, pages) = tokio::join!(library::list_recent_plays(db, Some(20)), pages);
    let mut recommendations = Vec::new();
    for page in pages {
        match page {
            Ok(page) => {
                recommendations.extend(page["items"].as_array().into_iter().flatten().cloned())
            }
            Err(error) => log::warn!("推荐分类加载失败：{error}"),
        }
    }
    Ok(json!({"recentPlays":recent?,"recommendations":recommendations}))
}
