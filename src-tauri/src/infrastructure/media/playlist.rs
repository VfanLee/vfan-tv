use crate::infrastructure::network::parse_http_url;
use regex::Regex;
use reqwest::Url;
use std::sync::LazyLock;

static URI_ATTRIBUTE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"\bURI="([^"]+)""#).expect("固定 HLS URI 表达式无效"));

/// 只重写 URI，原样保留 HLS 扩展标签、属性和换行
pub fn rewrite(
    playlist: &str,
    base: &Url,
    mut register: impl FnMut(Url) -> String,
) -> Result<String, String> {
    if !playlist
        .trim_start_matches('\u{feff}')
        .trim_start()
        .starts_with("#EXTM3U")
    {
        return Err("上游未返回有效 HLS 清单".to_owned());
    }
    let mut output = String::with_capacity(playlist.len());
    for line in playlist.split_inclusive('\n') {
        let trimmed = line.trim().trim_start_matches('\u{feff}');
        if trimmed.starts_with('#') {
            let mut previous = 0;
            for captures in URI_ATTRIBUTE.captures_iter(line) {
                let value = captures.get(1).expect("URI 捕获缺失");
                output.push_str(&line[previous..value.start()]);
                let url = base.join(value.as_str()).map_err(|_| "清单资源地址无效")?;
                output.push_str(&register(parse_http_url(url.as_str())?));
                previous = value.end();
            }
            output.push_str(&line[previous..]);
        } else if trimmed.is_empty() {
            output.push_str(line);
        } else {
            let url = base.join(trimmed).map_err(|_| "清单资源地址无效")?;
            output.push_str(&register(parse_http_url(url.as_str())?));
            if line.ends_with("\r\n") {
                output.push_str("\r\n");
            } else if line.ends_with('\n') {
                output.push('\n');
            }
        }
    }
    Ok(output)
}
