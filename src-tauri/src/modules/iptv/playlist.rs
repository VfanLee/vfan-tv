use crate::infrastructure::network;
use reqwest::Url;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stream {
    pub id: String,
    pub name: String,
    pub url: String,
    pub request_headers: RequestHeaders,
    pub is_live: bool,
}
#[derive(Clone, Serialize)]
pub struct RequestHeaders {
    pub headers: BTreeMap<String, String>,
}
#[derive(Clone, Serialize)]
pub struct Channel {
    pub id: String,
    pub title: String,
    pub group: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    pub streams: Vec<Stream>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub source_id: String,
    pub source_url: String,
    pub fetched_at: u64,
    pub cached: bool,
    pub stale: bool,
    pub channels: Vec<Channel>,
}

struct Item {
    title: String,
    group: String,
    logo: Option<String>,
    url: String,
    headers: BTreeMap<String, String>,
}

/// 解析 M3U 元数据或现有分组文本格式，合并同名频道并生成稳定标识
pub fn parse(content: &str, source_id: &str, base: &Url) -> Result<Playlist, String> {
    let content = content.trim_start_matches('\u{feff}').trim();
    let items = if content.starts_with("#EXTM3U") {
        let playlist = crispy_m3u::parse(content).map_err(|_| "直播 M3U 格式无效")?;
        let mut items = Vec::new();
        for entry in playlist.entries {
            let title = entry
                .name
                .filter(|name| !name.trim().is_empty())
                .or(entry.tvg_name)
                .unwrap_or_else(|| "未命名频道".into());
            let group = entry
                .group_title
                .filter(|group| !group.trim().is_empty())
                .unwrap_or_else(|| "未分组".into());
            let mut headers = BTreeMap::new();
            for (key, value) in entry.vlc_options {
                match key.to_ascii_lowercase().as_str() {
                    "http-referrer" | "http-referer" => {
                        headers.insert("referer".into(), value);
                    }
                    "http-user-agent" => {
                        headers.insert("user-agent".into(), value);
                    }
                    _ => {}
                }
            }
            let mut urls = entry.urls.to_vec();
            if let Some(url) = entry.url {
                if !urls.contains(&url) {
                    urls.insert(0, url);
                }
            }
            for url in urls {
                items.push(Item {
                    title: title.trim().into(),
                    group: group.trim().into(),
                    logo: entry.tvg_logo.clone(),
                    url,
                    headers: headers.clone(),
                });
            }
        }
        items
    } else {
        let mut items = Vec::new();
        let mut group = "未分组".to_owned();
        for line in content
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
        {
            if let Some((name, marker)) = line.rsplit_once(',') {
                if matches!(
                    marker.trim().to_ascii_lowercase().as_str(),
                    "#genre#" | "#group#"
                ) {
                    if !name.trim().is_empty() {
                        group = name.trim().into();
                    }
                    continue;
                }
            }
            let position = line.find("http://").or_else(|| line.find("https://"));
            let Some(position) = position else {
                continue;
            };
            let title = line[..position].trim_end_matches(',').trim();
            items.push(Item {
                title: if title.is_empty() {
                    "未命名频道".into()
                } else {
                    title.into()
                },
                group: group.clone(),
                logo: None,
                url: line[position..].trim().into(),
                headers: BTreeMap::new(),
            });
        }
        items
    };
    let mut channels: Vec<Channel> = Vec::new();
    let mut positions = HashMap::new();
    let mut channel_ids = HashSet::new();
    let mut stream_ids = HashSet::new();
    for item in items {
        let (address, suffix) = item.url.split_once('|').unwrap_or((&item.url, ""));
        let Ok(url) = base
            .join(address.trim())
            .and_then(|url| Url::parse(url.as_str()))
        else {
            continue;
        };
        let Ok(url) = network::parse_http_url(url.as_str()) else {
            continue;
        };
        let mut headers = item.headers;
        if !suffix.is_empty() {
            let query = Url::parse(&format!("http://headers.invalid/?{suffix}"))
                .map_err(|_| "直播线路请求头无效")?;
            for (key, value) in query.query_pairs() {
                let key = match key.to_lowercase().as_str() {
                    "referrer" => "referer".into(),
                    "useragent" => "user-agent".into(),
                    _ => key.to_lowercase(),
                };
                headers.insert(key, value.into_owned());
            }
        }
        let headers = network::source_headers(&url, &url, &headers)?
            .iter()
            .map(|(key, value)| {
                Ok((
                    key.to_string(),
                    value.to_str().map_err(|_| "直播请求头无效")?.to_owned(),
                ))
            })
            .collect::<Result<BTreeMap<_, _>, String>>()?;
        let key = (item.group.clone(), item.title.clone());
        let index = *positions.entry(key.clone()).or_insert_with(|| {
            let index = channels.len();
            let stable = serde_json::json!(key).to_string();
            let id = crispy_m3u::generate_stable_id(None, None, Some(&stable), &mut channel_ids);
            channels.push(Channel {
                id,
                title: item.title.clone(),
                group: item.group.clone(),
                logo: item
                    .logo
                    .as_deref()
                    .and_then(|logo| base.join(logo).ok())
                    .and_then(|url| network::parse_http_url(url.as_str()).ok())
                    .map(|url| url.to_string()),
                streams: vec![],
            });
            index
        });
        let channel = &mut channels[index];
        if channel
            .streams
            .iter()
            .any(|stream| stream.url == url.as_str())
        {
            continue;
        }
        let id = crispy_m3u::generate_stable_id(
            None,
            Some(&format!("{}:{url}", channel.id)),
            None,
            &mut stream_ids,
        );
        let extension = url
            .path()
            .rsplit('.')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        let is_live = !matches!(
            extension.as_str(),
            "mp4" | "m4v" | "mkv" | "mov" | "avi" | "wmv" | "webm"
        ) && !["点播", "录播", "回放", "春晚"]
            .iter()
            .any(|word| format!("{} {}", item.group, item.title).contains(word));
        channel.streams.push(Stream {
            id,
            name: format!("线路 {}", channel.streams.len() + 1),
            url: url.into(),
            request_headers: RequestHeaders { headers },
            is_live,
        });
    }
    if channels.is_empty() {
        return Err("IPTV 源中没有可播放频道".into());
    }
    Ok(Playlist {
        source_id: source_id.into(),
        source_url: base.to_string(),
        fetched_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "系统时间无效")?
            .as_millis() as u64,
        cached: false,
        stale: false,
        channels,
    })
}
