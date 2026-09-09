pub(crate) mod detect;
pub mod images;
mod playlist;
pub mod proxy;
#[cfg(test)]
mod tests;
pub(crate) mod types;

use crate::infrastructure::network::{self, NetworkMode};
use crate::modules::sources::{self, SourceKind};
use proxy::MediaProxy;
use reqwest::Url;
use sqlx::SqlitePool;
use std::collections::{BTreeMap, HashSet};
use tauri::State;
use types::{PlaybackInput, PlaybackTarget, SessionInfo, StreamType};

/// 读取源配置并解析候选地址，创建独立的播放会话
#[tauri::command]
pub async fn get_media_playback_target(
    proxy: State<'_, MediaProxy>,
    db: State<'_, SqlitePool>,
    input: PlaybackInput,
) -> Result<PlaybackTarget, String> {
    let source = match &input.source_id {
        Some(id) => Some(sources::find(&db, SourceKind::Vod, id).await?),
        None => None,
    };
    if source.as_ref().is_some_and(|source| source.disabled) {
        return Err("此点播源已停用".to_owned());
    }
    let client = network::create_client(&input.network_mode)?;
    let mut seen = HashSet::new();
    let mut candidates = input
        .candidates
        .into_iter()
        .take(32)
        .filter_map(|candidate| {
            if candidate.id.trim().is_empty() || !seen.insert(candidate.id.clone()) {
                return None;
            }
            network::parse_http_url(&candidate.url)
                .ok()
                .map(|url| (candidate, url))
        })
        .collect::<Vec<_>>();
    candidates.sort_by_key(|(_, url)| match detect::known_type(url) {
        Some(StreamType::Hls) => 0,
        Some(StreamType::Flv | StreamType::Mpegts) => 1,
        Some(StreamType::Native) => 2,
        None => 3,
    });
    if candidates.is_empty() {
        return Err("没有可用的播放线路".to_owned());
    }
    let mut failures = Vec::new();
    for (candidate, url) in candidates {
        let headers = match &source {
            Some(source) => network::source_headers(
                &network::parse_http_url(&source.url)?,
                &url,
                &source.headers,
            )?,
            None => Default::default(),
        };
        let session_headers = headers
            .iter()
            .map(|(name, value)| {
                Ok((
                    name.to_string(),
                    value.to_str().map_err(|_| "请求头格式无效")?.to_owned(),
                ))
            })
            .collect::<Result<BTreeMap<_, _>, String>>()?;
        match detect::detect(&client, &url, headers).await {
            Ok(kind) => {
                let route = match input.network_mode {
                    NetworkMode::Direct => "直连",
                    NetworkMode::System => "系统代理",
                };
                let (src, id) = proxy
                    .create(url, kind, client.clone(), route.to_owned(), session_headers)
                    .await?;
                return Ok(PlaybackTarget {
                    src,
                    media_session_id: id,
                    stream_type: kind,
                    selected_candidate_id: candidate.id,
                    selected_candidate_name: candidate.name,
                });
            }
            Err(error) => failures.push(error),
        }
    }
    Err(format!("全部播放线路均不可用：{}", failures.join("；")))
}

/// 获取播放器诊断信息
#[tauri::command]
pub async fn get_media_session_info(
    proxy: State<'_, MediaProxy>,
    media_session_id: String,
) -> Result<SessionInfo, String> {
    proxy
        .sessions
        .read()
        .await
        .get(&media_session_id)
        .map(|session| session.info.clone())
        .ok_or("播放会话已失效".to_owned())
}

/// 保留会话供多个播放窗口交接使用
#[tauri::command]
pub async fn retain_media_session(
    proxy: State<'_, MediaProxy>,
    media_session_id: String,
) -> Result<(), String> {
    let mut sessions = proxy.sessions.write().await;
    let session = sessions
        .get_mut(&media_session_id)
        .ok_or("播放会话已失效")?;
    session.references = session
        .references
        .checked_add(1)
        .ok_or("播放会话引用过多")?;
    session.touched = std::time::Instant::now();
    Ok(())
}

/// 释放会话，最后一个引用关闭时取消上游流
#[tauri::command]
pub async fn release_media_session(
    proxy: State<'_, MediaProxy>,
    media_session_id: String,
) -> Result<(), String> {
    let mut sessions = proxy.sessions.write().await;
    if let Some(session) = sessions.get_mut(&media_session_id) {
        session.references = session.references.saturating_sub(1);
        if session.references == 0 {
            session.cancel.cancel();
            sessions.remove(&media_session_id);
        }
    }
    Ok(())
}

/// 为原生或分离音轨生成同会话代理地址
#[tauri::command]
pub async fn get_associated_audio_url(
    proxy: State<'_, MediaProxy>,
    media_session_id: String,
    url: String,
) -> Result<String, String> {
    let url: Url = network::parse_http_url(&url)?;
    proxy.associated_url(&media_session_id, url).await
}
