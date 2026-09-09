use super::{
    playlist,
    types::{SessionInfo, StreamType},
};
use crate::infrastructure::network;
use axum::{
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use futures_util::StreamExt;
use reqwest::{Client, Url};
use std::{
    collections::{BTreeMap, HashMap},
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub struct Session {
    pub info: SessionInfo,
    pub client: Client,
    pub headers: BTreeMap<String, String>,
    pub resources: HashMap<String, Url>,
    resource_tokens: HashMap<Url, String>,
    pub references: u32,
    pub touched: Instant,
    pub cancel: CancellationToken,
}

#[derive(Clone)]
pub struct MediaProxy {
    pub base_url: String,
    pub images: super::images::Images,
    pub sessions: Arc<RwLock<HashMap<String, Session>>>,
    shutdown: CancellationToken,
}

impl MediaProxy {
    /// 在回环地址随机端口启动媒体代理与过期会话清理
    pub async fn start() -> Result<Self, String> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| "无法启动本地媒体代理")?;
        let port = listener
            .local_addr()
            .map_err(|_| "无法读取媒体端口")?
            .port();
        let proxy = Self {
            images: Default::default(),
            base_url: format!("http://127.0.0.1:{port}"),
            sessions: Arc::default(),
            shutdown: CancellationToken::new(),
        };
        let router = Router::new()
            .route("/image/{token}", get(super::images::serve_image))
            .route(
                "/media/{session}/{resource}",
                get(serve_media).options(preflight),
            )
            .with_state(proxy.clone());
        let stop = proxy.shutdown.clone();
        tokio::spawn(async move {
            if let Err(error) = axum::serve(listener, router)
                .with_graceful_shutdown(stop.cancelled_owned())
                .await
            {
                log::warn!("媒体代理停止: {error}");
            }
        });
        let cleanup = proxy.clone();
        tokio::spawn(async move {
            let mut timer = tokio::time::interval(Duration::from_secs(300));
            loop {
                tokio::select! {
                    _ = cleanup.shutdown.cancelled() => break,
                    _ = timer.tick() => {
                        cleanup.sessions.write().await.retain(|_, session| {
                            let retain = session.touched.elapsed() < Duration::from_secs(12 * 3600);
                            if !retain { session.cancel.cancel(); }
                            retain
                        });
                    }
                }
            }
        });
        Ok(proxy)
    }

    /// 创建持有路由客户端快照的播放会话
    pub async fn create(
        &self,
        url: Url,
        stream_type: StreamType,
        client: Client,
        network: String,
        headers: BTreeMap<String, String>,
    ) -> Result<(String, String), String> {
        let mut sessions = self.sessions.write().await;
        if sessions.len() >= 128 {
            return Err("播放会话过多，请关闭未使用的播放器".to_owned());
        }
        let id = Uuid::new_v4().to_string();
        let resource = Uuid::new_v4().to_string();
        let info = SessionInfo {
            media_session_id: id.clone(),
            original_url: url.to_string(),
            final_url: None,
            stream_type,
            network,
            created_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        };
        sessions.insert(
            id.clone(),
            Session {
                info,
                client,
                headers,
                resources: HashMap::from([(resource.clone(), url.clone())]),
                resource_tokens: HashMap::from([(url, resource.clone())]),
                references: 1,
                touched: Instant::now(),
                cancel: CancellationToken::new(),
            },
        );
        Ok((format!("{}/media/{id}/{resource}", self.base_url), id))
    }

    /// 停止所有会话、流式请求与本地监听
    pub async fn stop(&self) {
        self.shutdown.cancel();
        for (_, session) in self.sessions.write().await.drain() {
            session.cancel.cancel();
        }
    }

    /// 为关联音轨注册同一会话下的地址
    pub async fn associated_url(&self, session_id: &str, url: Url) -> Result<String, String> {
        if url
            .as_str()
            .starts_with(&format!("{}/media/{session_id}/", self.base_url))
        {
            return Ok(url.to_string());
        }
        let mut sessions = self.sessions.write().await;
        let session = sessions.get_mut(session_id).ok_or("播放会话已失效")?;
        let token = register(session, url)?;
        Ok(format!("{}/media/{session_id}/{token}", self.base_url))
    }
}

/// 复用同一资源的令牌并限制单个会话的内存占用
fn register(session: &mut Session, url: Url) -> Result<String, String> {
    if let Some(key) = session.resource_tokens.get(&url) {
        return Ok(key.clone());
    }
    if session.resources.len() >= 65536 {
        return Err("播放会话资源过多，请重新打开播放".to_owned());
    }
    let token = Uuid::new_v4().to_string();
    session.resources.insert(token.clone(), url.clone());
    session.resource_tokens.insert(url, token.clone());
    Ok(token)
}

/// 为媒体响应添加跨域与缓存规则
fn cors(response: &mut Response) {
    for (name, value) in [
        ("access-control-allow-origin", "*"),
        ("access-control-allow-headers", "Range, Content-Type"),
        ("access-control-allow-methods", "GET, HEAD, OPTIONS"),
        (
            "access-control-expose-headers",
            "Content-Length, Content-Range, Accept-Ranges",
        ),
        ("cache-control", "no-store"),
    ] {
        response
            .headers_mut()
            .insert(name, HeaderValue::from_static(value));
    }
}

/// 响应播放器跨域预检
async fn preflight() -> Response {
    let mut response = StatusCode::NO_CONTENT.into_response();
    cors(&mut response);
    response
}

/// 处理令牌资源请求，错误响应不泄露上游 URL 与凭据
async fn serve_media(
    State(proxy): State<MediaProxy>,
    Path((id, resource)): Path<(String, String)>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    let mut response = match forward(&proxy, &id, &resource, method, headers).await {
        Ok(response) => response,
        Err((status, message)) => (status, message).into_response(),
    };
    cors(&mut response);
    response
}

/// 转发媒体流，清单限量读取后重写，其余内容按需流式传输
async fn forward(
    proxy: &MediaProxy,
    id: &str,
    resource: &str,
    method: Method,
    headers: HeaderMap,
) -> Result<Response, (StatusCode, String)> {
    let (url, client, configured, origin, cancel, stream_type) = {
        let mut sessions = proxy.sessions.write().await;
        let session = sessions
            .get_mut(id)
            .ok_or((StatusCode::GONE, "播放会话已失效".to_owned()))?;
        let url = session
            .resources
            .get(resource)
            .ok_or((StatusCode::NOT_FOUND, "资源不存在".to_owned()))?
            .clone();
        session.touched = Instant::now();
        (
            url,
            session.client.clone(),
            session.headers.clone(),
            session.info.original_url.clone(),
            session.cancel.clone(),
            session.info.stream_type,
        )
    };
    let map_error = |message: String| (StatusCode::BAD_GATEWAY, message);
    let origin = network::parse_http_url(&origin).map_err(map_error)?;
    let mut outgoing = network::source_headers(&origin, &url, &configured).map_err(map_error)?;
    // HLS 的 TS 分片可以有字节范围，只有直播根流省略 Range
    if !matches!(stream_type, StreamType::Flv | StreamType::Mpegts) {
        if let Some(range) = headers.get("range") {
            outgoing.insert("range", range.clone());
        }
    }
    let response = tokio::select! {
        _ = cancel.cancelled() => return Err((StatusCode::GONE, "播放会话已关闭".to_owned())),
        result = network::request(&client, method.clone(), url.clone(), outgoing) => result.map_err(map_error)?,
    };
    let status = response.status();
    let final_url = response.url().clone();
    if url == origin {
        if let Some(session) = proxy.sessions.write().await.get_mut(id) {
            session.info.final_url = Some(final_url.to_string());
        }
    }
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let playlist = (stream_type == StreamType::Hls && url == origin)
        || final_url.path().to_lowercase().ends_with(".m3u8")
        || content_type.contains("mpegurl");
    let mut result = Response::builder().status(status);
    for name in [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "content-encoding",
    ] {
        if let Some(value) = response.headers().get(name) {
            result = result.header(name, value);
        }
    }
    if method == Method::HEAD {
        return result
            .body(Body::empty())
            .map_err(|_| map_error("响应构建失败".to_owned()));
    }
    if playlist && status.is_success() {
        let stream = response
            .bytes_stream()
            .take_until(cancel.clone().cancelled_owned());
        futures_util::pin_mut!(stream);
        let mut bytes = Vec::new();
        let read = async {
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|_| "读取清单失败".to_owned())?;
                if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
                    return Err("清单超出大小限制".to_owned());
                }
                bytes.extend_from_slice(&chunk);
            }
            if cancel.is_cancelled() {
                return Err("播放会话已关闭".to_owned());
            }
            Ok(())
        };
        tokio::time::timeout(Duration::from_secs(15), read)
            .await
            .map_err(|_| map_error("清单读取超时".to_owned()))?
            .map_err(map_error)?;
        let playlist =
            std::str::from_utf8(&bytes).map_err(|_| map_error("清单不是 UTF-8 文本".to_owned()))?;
        let mut sessions = proxy.sessions.write().await;
        let session = sessions
            .get_mut(id)
            .ok_or((StatusCode::GONE, "播放会话已关闭".to_owned()))?;
        let mut registration_error = None;
        let rewritten =
            playlist::rewrite(playlist, &final_url, |url| match register(session, url) {
                Ok(token) => format!("{}/media/{id}/{token}", proxy.base_url),
                Err(error) => {
                    registration_error = Some(error);
                    String::new()
                }
            })
            .map_err(map_error)?;
        if let Some(error) = registration_error {
            return Err(map_error(error));
        }
        return Response::builder()
            .status(status)
            .header("content-type", "application/vnd.apple.mpegurl")
            .body(Body::from(rewritten))
            .map_err(|_| map_error("响应构建失败".to_owned()));
    }
    // Body 被浏览器断开时会释放 reqwest 流；会话关闭也主动结束流
    result
        .body(Body::from_stream(
            response.bytes_stream().take_until(cancel.cancelled_owned()),
        ))
        .map_err(|_| map_error("响应构建失败".to_owned()))
}
