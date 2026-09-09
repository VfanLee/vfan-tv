use super::{proxy::MediaProxy, types::StreamType};
use crate::infrastructure::network::{self, NetworkMode};
use axum::{
    body::Body,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Redirect, Response},
    routing::get,
    Router,
};
use std::collections::BTreeMap;

/// 启动仅供测试使用的本地上游，句柄用于测试结束时关闭
async fn upstream() -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let router = Router::new()
        .route(
            "/redirect",
            get(|| async { Redirect::temporary("/hls/main.m3u8") }),
        )
        .route(
            "/hls/main.m3u8",
            get(|| async {
                (
                    [("content-type", "application/vnd.apple.mpegurl")],
                    "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"../key\"\n#EXTINF:5,\n../range\n",
                )
            }),
        )
        .route("/key", get(|| async { "0123456789abcdef" }))
        .route("/range", get(range))
        .route(
            "/error",
            get(|| async { (StatusCode::FORBIDDEN, "denied") }),
        );
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (address, task)
}

/// 返回可检查的字节范围响应
async fn range(headers: HeaderMap) -> Response {
    if headers.get("range").and_then(|value| value.to_str().ok()) == Some("bytes=2-5") {
        Response::builder()
            .status(206)
            .header("content-type", "video/mp4")
            .header("content-range", "bytes 2-5/10")
            .header("accept-ranges", "bytes")
            .body(Body::from("2345"))
            .unwrap()
    } else {
        "0123456789".into_response()
    }
}

/// 验证清单重定向、子资源、Range 与会话关闭，无需真实媒体源或 GUI
#[tokio::test]
async fn proxies_playlist_and_ranges() {
    let (origin, task) = upstream().await;
    let proxy = MediaProxy::start().await.unwrap();
    let client = network::create_client(&NetworkMode::Direct).unwrap();
    let (url, id) = proxy
        .create(
            network::parse_http_url(&format!("{origin}/redirect")).unwrap(),
            StreamType::Hls,
            client.clone(),
            "direct".into(),
            BTreeMap::new(),
        )
        .await
        .unwrap();
    let response = client.get(&url).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["access-control-allow-origin"], "*");
    let playlist = response.text().await.unwrap();
    assert!(!playlist.contains(&origin));
    let segment = playlist
        .lines()
        .find(|line| line.starts_with("http"))
        .unwrap();
    let response = client
        .get(segment)
        .header("range", "bytes=2-5")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(response.headers()["content-range"], "bytes 2-5/10");
    assert_eq!(response.text().await.unwrap(), "2345");
    let head = client.head(segment).send().await.unwrap();
    assert!(head.bytes().await.unwrap().is_empty());
    let session = proxy.sessions.read().await.get(&id).unwrap().info.clone();
    assert_eq!(
        session.final_url.unwrap(),
        format!("{origin}/hls/main.m3u8")
    );
    // 清单刷新复用同一组令牌，不重复增长资源表
    let count = proxy
        .sessions
        .read()
        .await
        .get(&id)
        .unwrap()
        .resources
        .len();
    client.get(&url).send().await.unwrap().text().await.unwrap();
    assert_eq!(
        proxy
            .sessions
            .read()
            .await
            .get(&id)
            .unwrap()
            .resources
            .len(),
        count
    );
    proxy
        .sessions
        .write()
        .await
        .remove(&id)
        .unwrap()
        .cancel
        .cancel();
    assert_eq!(
        client.get(&url).send().await.unwrap().status(),
        StatusCode::GONE
    );
    proxy.stop().await;
    task.abort();
}

/// 不将上游错误误报为成功，也不把错误页按清单重写
#[tokio::test]
async fn preserves_upstream_errors() {
    let (origin, task) = upstream().await;
    let proxy = MediaProxy::start().await.unwrap();
    let client = network::create_client(&NetworkMode::Direct).unwrap();
    let (url, _) = proxy
        .create(
            network::parse_http_url(&format!("{origin}/error")).unwrap(),
            StreamType::Hls,
            client.clone(),
            "direct".into(),
            BTreeMap::new(),
        )
        .await
        .unwrap();
    assert_eq!(
        client.get(url).send().await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    proxy.stop().await;
    task.abort();
}
