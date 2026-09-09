use regex::Regex;
use std::sync::LazyLock;

/// 匹配日志中的 URL 凭据、认证头和常见密钥字段
static RULES: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    vec![
    (Regex::new(r"(?i)(https?://)[^/@\s:]+:[^/@\s]+@").unwrap(), "${1}[REDACTED]@"),
    (Regex::new(r#"(?i)([?&](?:access_?token|api_?key|auth(?:_?key)?|key|password|passwd|pwd|secret|sign(?:ature)?|token|wssecret)=)[^&\s\"'#]*"#).unwrap(), "${1}[REDACTED]"),
    (Regex::new(r#"(?i)(\b(?:proxy-authorization|authorization|set-cookie|cookie)[\"']?\s*[:=]\s*)[^|\r\n]+"#).unwrap(), "${1}[REDACTED]"),
    (Regex::new(r#"(?i)(\b(?:access_?token|api[_-]?key|password|passwd|pwd|secret|token|wssecret|signature|sign|auth[_-]?key)[\"']?\s*[:=]\s*)(\"[^\"]*\"|'[^']*'|[^\s,;&|}]+)"#).unwrap(), "${1}[REDACTED]"),
]
});

/// 截断单条日志并脱敏认证信息，移除控制字符以保持日志可读
pub(super) fn text(value: &str) -> String {
    let mut result = value
        .chars()
        .take(16384)
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .collect::<String>();
    for (pattern, replacement) in RULES.iter() {
        result = pattern.replace_all(&result, *replacement).into_owned();
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    /// 前后端日志共用脱敏，保留排错所需地址和普通参数
    #[test]
    fn hides_credentials() {
        let value = text("https://user:pass@host/path?token=hidden&page=2 | Authorization: Bearer credential\n{\"api_key\":\"private\",\"password\":\"secret\"}");
        for secret in ["user:pass", "hidden", "credential", "private", "\"secret\""] {
            assert!(!value.contains(secret), "{value}");
        }
        assert!(value.contains("page=2"));
        assert!(value.contains("host/path"));
        assert!(text(&"中".repeat(20000)).chars().count() <= 16384);
    }
}
