use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue, LOCATION},
    Client, Method, Response, Url,
};
use serde::Deserialize;
use std::{collections::BTreeMap, time::Duration};

/// macOS 网络请求默认模拟系统 Safari
#[cfg(target_os = "macos")]
const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";

/// Windows 网络请求默认模拟桌面 Chrome
#[cfg(target_os = "windows")]
const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/// 其他构建目标使用桌面 Chrome，保证开发检查可编译
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/// 有界响应读取失败的原因，由业务调用方补充错误上下文
#[derive(Debug)]
pub enum BodyReadError {
    Read(reqwest::Error),
    TooLarge,
}

/// 按实际接收字节限制响应大小，不依赖上游 Content-Length 声明
pub async fn read_limited(mut response: Response, limit: usize) -> Result<Vec<u8>, BodyReadError> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(BodyReadError::Read)? {
        if chunk.len() > limit.saturating_sub(bytes.len()) {
            return Err(BodyReadError::TooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NetworkMode {
    #[default]
    Direct,
    System,
}

/// 解析可供媒体和内容服务访问的 HTTP 地址
pub fn parse_http_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value.trim()).map_err(|_| "地址格式无效".to_owned())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("仅支持不含内嵌凭据的 HTTP 或 HTTPS 地址".to_owned());
    }
    Ok(url)
}

/// 建立独立路由客户端，直连显式忽略环境代理，媒体流不设置整体下载时限
pub fn client_builder() -> reqwest::ClientBuilder {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .referer(false)
        .user_agent(DEFAULT_USER_AGENT)
}

/// 按直连或系统代理模式建立客户端
pub fn create_client(mode: &NetworkMode) -> Result<Client, String> {
    let mut builder = client_builder();
    if matches!(mode, NetworkMode::Direct) {
        builder = builder.no_proxy();
    }
    builder
        .build()
        .map_err(|_| "初始化网络客户端失败".to_owned())
}

/// 过滤不应由源配置覆盖的传输头及跨域凭据
pub fn source_headers(
    origin: &Url,
    target: &Url,
    headers: &BTreeMap<String, String>,
) -> Result<HeaderMap, String> {
    let mut output = HeaderMap::new();
    for (key, value) in headers {
        let key = key.trim().to_ascii_lowercase();
        if matches!(
            key.as_str(),
            "host"
                | "content-length"
                | "connection"
                | "transfer-encoding"
                | "range"
                | "proxy-authorization"
                | "accept-encoding"
        ) {
            continue;
        }
        if origin.origin() != target.origin() && matches!(key.as_str(), "authorization" | "cookie")
        {
            continue;
        }
        let name =
            HeaderName::from_bytes(key.as_bytes()).map_err(|_| "请求头名称无效".to_owned())?;
        let value = HeaderValue::from_str(value.trim()).map_err(|_| "请求头内容无效".to_owned())?;
        output.insert(name, value);
    }
    Ok(output)
}

/// 显式逐跳处理重定向，凭据跨域后不再恢复
pub async fn request(
    client: &Client,
    method: Method,
    mut url: Url,
    mut headers: HeaderMap,
) -> Result<Response, String> {
    headers.insert("accept-encoding", HeaderValue::from_static("identity"));
    let started = std::time::Instant::now();
    let result = tokio::time::timeout(Duration::from_secs(15), async {
        for _ in 0..=10 {
            let response = client
                .request(method.clone(), url.clone())
                .headers(headers.clone())
                .send()
                .await
                .map_err(|error| {
                    if error.is_timeout() {
                        "网络请求超时"
                    } else {
                        "无法连接上游服务器"
                    }
                    .to_owned()
                })?;
            if !matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
                return Ok(response);
            }
            let location = response
                .headers()
                .get(LOCATION)
                .ok_or("重定向缺少目标地址")?
                .to_str()
                .map_err(|_| "重定向地址无效")?;
            let next = url.join(location).map_err(|_| "重定向地址无效")?;
            let next = parse_http_url(next.as_str())?;
            if next.origin() != url.origin() {
                headers.remove("authorization");
                headers.remove("cookie");
                headers.remove("proxy-authorization");
            }
            url = next;
        }
        Err("重定向次数过多".to_owned())
    })
    .await
    .map_err(|_| "网络请求超时".to_owned())
    .and_then(|result| result);
    match &result {
        Ok(response) => {
            log::log!(target: "network", if response.status().is_client_error() || response.status().is_server_error() { log::Level::Warn } else { log::Level::Info }, "{} {} | HTTP {} | {}ms", method, url, response.status().as_u16(), started.elapsed().as_millis())
        }
        Err(error) => {
            log::warn!(target: "network", "{} {} | {} | {}ms", method, url, error, started.elapsed().as_millis())
        }
    }
    result
}
