use super::types::StreamType;
use crate::infrastructure::network;
use reqwest::{
    header::{HeaderMap, HeaderValue},
    Client, Method, Url,
};
use std::time::Duration;

/// 根据媒体扩展名选择播放器引擎，实际可用性由代理响应和播放器确认
pub fn known_type(url: &Url) -> Option<StreamType> {
    let path = url.path().to_lowercase();
    match path.rsplit('.').next()? {
        "m3u8" => Some(StreamType::Hls),
        "flv" => Some(StreamType::Flv),
        "ts" | "m2ts" => Some(StreamType::Mpegts),
        "mp4" | "m4v" | "mov" | "webm" | "ogv" | "ogg" | "mkv" | "mp3" | "aac" | "m4a" => {
            Some(StreamType::Native)
        }
        _ => None,
    }
}

/// 按响应 MIME 选择引擎，不将 HTML、JSON 或未知格式当作视频
fn mime_type(value: &str) -> Option<StreamType> {
    let value = value.to_ascii_lowercase();
    if value.contains("mpegurl") {
        Some(StreamType::Hls)
    } else if value.contains("flv") {
        Some(StreamType::Flv)
    } else if value.contains("mp2t") || value.contains("mpegts") {
        Some(StreamType::Mpegts)
    } else if value.starts_with("video/") || value.starts_with("audio/") {
        Some(StreamType::Native)
    } else {
        None
    }
}

/// 检查有限响应前缀，常见文件格式交给 infer 识别
fn prefix_type(bytes: &[u8]) -> Option<StreamType> {
    if String::from_utf8_lossy(bytes)
        .trim_start_matches('\u{feff}')
        .trim_start()
        .starts_with("#EXTM3U")
    {
        return Some(StreamType::Hls);
    }
    // TS 是连续传输包，支持普通 TS 和带四字节前缀的 M2TS
    for (offset, size) in [(0, 188), (4, 192)] {
        if [offset, offset + size, offset + size * 2]
            .iter()
            .all(|&index| bytes.get(index) == Some(&0x47))
        {
            return Some(StreamType::Mpegts);
        }
    }
    infer::get(bytes).and_then(|kind| mime_type(kind.mime_type()))
}

/// 探测未知媒体地址，限制时间和读取量并释放上游响应
pub async fn detect(client: &Client, url: &Url, headers: HeaderMap) -> Result<StreamType, String> {
    if let Some(kind) = known_type(url) {
        return Ok(kind);
    }
    let mut failure = "无法识别媒体格式".to_owned();
    for _ in 0..2 {
        let attempt = tokio::time::timeout(Duration::from_secs(8), async {
            let mut headers = headers.clone();
            headers.insert("range", HeaderValue::from_static("bytes=0-65535"));
            let mut response = network::request(client, Method::GET, url.clone(), headers).await?;
            if !response.status().is_success() {
                return Err(format!("上游返回 HTTP {}", response.status().as_u16()));
            }
            let mime = response
                .headers()
                .get("content-type")
                .and_then(|value| value.to_str().ok())
                .unwrap_or("");
            if let Some(kind) = mime_type(mime) {
                return Ok(kind);
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| "读取媒体响应失败")?
            {
                let count = chunk.len().min(65536 - bytes.len());
                bytes.extend_from_slice(&chunk[..count]);
                if let Some(kind) = prefix_type(&bytes) {
                    return Ok(kind);
                }
                if bytes.len() >= 65536 {
                    break;
                }
                let prefix = String::from_utf8_lossy(&bytes)
                    .trim_start()
                    .to_ascii_lowercase();
                if prefix.starts_with("<!doctype")
                    || prefix.starts_with("<html")
                    || prefix.starts_with('{')
                    || prefix.starts_with('[')
                {
                    return Err("上游返回的不是媒体内容".to_owned());
                }
            }
            Err("无法识别媒体格式".to_owned())
        })
        .await;
        match attempt {
            Ok(Ok(kind)) => return Ok(kind),
            Ok(Err(error)) => failure = error,
            Err(_) => failure = "媒体探测超时".to_owned(),
        }
    }
    Err(failure)
}

#[cfg(test)]
mod tests {
    use super::*;
    /// 拒绝网页，并识别没有扩展名的 HLS 与 TS 内容
    #[test]
    fn recognizes_media_prefixes() {
        assert_eq!(
            prefix_type(b"#EXTM3U\n#EXTINF:6,\nseg.ts"),
            Some(StreamType::Hls)
        );
        assert_eq!(prefix_type(b"<html>error</html>"), None);
        let mut packets = vec![0; 565];
        for index in [0, 188, 376] {
            packets[index] = 0x47;
        }
        assert_eq!(prefix_type(&packets), Some(StreamType::Mpegts));
    }
}
