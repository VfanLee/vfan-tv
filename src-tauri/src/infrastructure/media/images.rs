use super::proxy::MediaProxy;
use crate::{infrastructure::network, modules::network_settings, modules::sources::Source};
use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use reqwest::{Client, Url};
use sqlx::SqlitePool;
use std::{collections::HashMap, sync::Arc, time::Instant};
use tauri::State as AppState;
use tokio::sync::{RwLock, Semaphore};

#[derive(Clone)]
struct ImageResource {
    url: Url,
    headers: reqwest::header::HeaderMap,
    client: Client,
    touched: Instant,
}

#[derive(Clone)]
pub struct Images {
    entries: Arc<RwLock<HashMap<String, ImageResource>>>,
    permits: Arc<Semaphore>,
}

impl Default for Images {
    /// 图片并发独立限流，不占用媒体播放会话
    fn default() -> Self {
        Self {
            entries: Arc::default(),
            permits: Arc::new(Semaphore::new(8)),
        }
    }
}

/// 解析源图片相对地址与请求头，返回回环代理地址
#[tauri::command]
pub async fn get_source_image_url(
    db: AppState<'_, SqlitePool>,
    proxy: AppState<'_, MediaProxy>,
    source_type: String,
    source_id: Option<String>,
    url: String,
    base_url: Option<String>,
) -> Result<String, String> {
    if !matches!(source_type.as_str(), "vod" | "iptv" | "radio" | "douban") {
        return Err("图片来源类型无效".into());
    }
    let source: Option<Source> = if let Some(id) = source_id {
        sqlx::query_as("SELECT * FROM sources WHERE kind=? AND id=?")
            .bind(&source_type)
            .bind(id)
            .fetch_optional(db.inner())
            .await
            .map_err(|_| "读取图片源配置失败")?
    } else {
        None
    };
    let base = base_url
        .as_deref()
        .or_else(|| source.as_ref().map(|source| source.url.as_str()));
    let target = match Url::parse(url.trim()) {
        Ok(url) => url,
        Err(_) => network::parse_http_url(base.ok_or("相对图片地址缺少来源")?)?
            .join(url.trim())
            .map_err(|_| "图片地址无效")?,
    };
    let target = network::parse_http_url(target.as_str())?;
    let headers = if let Some(source) = &source {
        network::source_headers(
            &network::parse_http_url(&source.url)?,
            &target,
            &source.headers,
        )?
    } else {
        Default::default()
    };
    let client = if source_type == "iptv" {
        network_settings::client(&network_settings::read(&db).await?)?
    } else {
        network::create_client(&network::NetworkMode::Direct)?
    };
    let mut entries = proxy.images.entries.write().await;
    if entries.len() >= 2048 {
        if let Some(oldest) = entries
            .iter()
            .min_by_key(|(_, resource)| resource.touched)
            .map(|(id, _)| id.clone())
        {
            entries.remove(&oldest);
        }
    }
    let token = uuid::Uuid::new_v4().to_string();
    entries.insert(
        token.clone(),
        ImageResource {
            url: target,
            headers,
            client,
            touched: Instant::now(),
        },
    );
    Ok(format!("{}/image/{token}", proxy.base_url))
}

/// 限流读取图片，拒绝网页响应并限制内存与总耗时
pub async fn serve_image(State(proxy): State<MediaProxy>, Path(token): Path<String>) -> Response {
    let resource = {
        let mut entries = proxy.images.entries.write().await;
        entries.get_mut(&token).map(|resource| {
            resource.touched = Instant::now();
            resource.clone()
        })
    };
    let Some(resource) = resource else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let result = tokio::time::timeout(std::time::Duration::from_secs(15), async {
        let _permit = proxy
            .images
            .permits
            .acquire()
            .await
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
        let mut response = network::request(
            &resource.client,
            reqwest::Method::GET,
            resource.url,
            resource.headers,
        )
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;
        if !response.status().is_success() {
            return Err(response.status());
        }
        let mime = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_owned();
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| StatusCode::BAD_GATEWAY)?
        {
            if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
                return Err(StatusCode::PAYLOAD_TOO_LARGE);
            }
            bytes.extend_from_slice(&chunk);
        }
        let mime = if mime.starts_with("image/") {
            mime
        } else {
            infer::get(&bytes)
                .map(|kind| kind.mime_type().to_owned())
                .filter(|mime| mime.starts_with("image/"))
                .ok_or(StatusCode::UNSUPPORTED_MEDIA_TYPE)?
        };
        Ok((
            [
                (header::CONTENT_TYPE, mime),
                (header::CACHE_CONTROL, "private, max-age=300".into()),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff".into()),
            ],
            bytes,
        )
            .into_response())
    })
    .await;
    match result {
        Ok(Ok(response)) => response,
        Ok(Err(status)) => status.into_response(),
        Err(_) => StatusCode::GATEWAY_TIMEOUT.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    /// 图片代理保留图片响应并拒绝 HTML 错误页
    #[tokio::test]
    async fn image_proxy_rejects_non_image_responses() {
        use axum::{routing::get, Router};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new()
                    .route(
                        "/image",
                        get(|| async {
                            (
                                [(header::CONTENT_TYPE, "image/png")],
                                vec![137, 80, 78, 71, 13, 10, 26, 10],
                            )
                        }),
                    )
                    .route(
                        "/error",
                        get(|| async {
                            ([(header::CONTENT_TYPE, "text/html")], "<html>Error</html>")
                        }),
                    ),
            )
            .await
            .unwrap();
        });
        let proxy = MediaProxy::start().await.unwrap();
        let client = network::create_client(&network::NetworkMode::Direct).unwrap();
        for path in ["image", "error"] {
            proxy.images.entries.write().await.insert(
                path.into(),
                ImageResource {
                    url: Url::parse(&format!("http://{address}/{path}")).unwrap(),
                    headers: Default::default(),
                    client: client.clone(),
                    touched: Instant::now(),
                },
            );
        }
        let image = client
            .get(format!("{}/image/image", proxy.base_url))
            .send()
            .await
            .unwrap();
        assert_eq!(image.status(), StatusCode::OK);
        assert_eq!(image.headers()[header::CONTENT_TYPE], "image/png");
        assert_eq!(image.bytes().await.unwrap().len(), 8);
        let error = client
            .get(format!("{}/image/error", proxy.base_url))
            .send()
            .await
            .unwrap();
        assert_eq!(error.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
        proxy.stop().await;
        server.abort();
        let _ = server.await;
    }
}
