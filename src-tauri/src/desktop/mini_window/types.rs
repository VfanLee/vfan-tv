use serde::Deserialize;
use serde_json::{json, Value};

/// 校验小窗上下文并生成默认退出快照
pub(super) fn initial_exit(context: &Value) -> Result<Value, String> {
    let id = context["sessionId"]
        .as_str()
        .filter(|id| uuid::Uuid::parse_str(id).is_ok())
        .ok_or("小窗标识无效")?;
    let variant = context["variant"].as_str().ok_or("小窗类型无效")?;
    let exit = match variant {
        "vod" | "live" => {
            if !matches!(
                context["sourceType"].as_str(),
                Some("hls" | "flv" | "mpegts" | "native")
            ) || context["mediaSessionId"].as_str().is_none()
                || context["src"].as_str().is_none()
                || !context["loop"].is_boolean()
            {
                return Err("视频小窗参数无效".into());
            }
            json!({"sessionId":id,"variant":variant,"currentTime":context["initialTime"]})
        }
        "radio" => {
            json!({"sessionId":id,"variant":variant,"channel":context["channel"],"volume":context["volume"],"isMuted":context["isMuted"],"isPlaying":true})
        }
        _ => return Err("小窗类型无效".into()),
    };
    validate_exit(context, &exit)?;
    Ok(exit)
}

/// 拒绝不属于当前小窗或包含无效进度、音量的快照
pub(super) fn validate_exit(context: &Value, exit: &Value) -> Result<(), String> {
    if exit["sessionId"] != context["sessionId"] || exit["variant"] != context["variant"] {
        return Err("小窗播放已变更".into());
    }
    let valid = if exit["variant"] == "radio" {
        exit["channel"]["id"].as_u64().is_some_and(|id| id > 0)
            && exit["channel"]["title"]
                .as_str()
                .is_some_and(|s| !s.trim().is_empty() && s.len() <= 4096)
            && exit["volume"]
                .as_f64()
                .is_some_and(|v| (0.0..=1.0).contains(&v))
            && exit["isMuted"].is_boolean()
            && exit["isPlaying"].is_boolean()
    } else {
        exit["currentTime"]
            .as_f64()
            .is_some_and(|v| v.is_finite() && v >= 0.0)
    };
    if !valid || exit.to_string().len() > 32768 {
        return Err("小窗播放状态无效".into());
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct Position {
    pub(super) x: f64,
    pub(super) y: f64,
}
#[derive(Deserialize)]
pub struct Bounds {
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) width: f64,
    pub(super) height: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Move {
    pub(super) session_id: String,
    pub(super) position: Position,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resize {
    pub(super) session_id: String,
    pub(super) corner: String,
    pub(super) bounds: Bounds,
}

/// 约束尺寸并维持拖动对角的位置
pub(super) fn resize_bounds(input: &Resize, radio: bool) -> Result<Bounds, String> {
    let b = &input.bounds;
    if ![b.x, b.y, b.width, b.height]
        .into_iter()
        .all(|v| v.is_finite() && v.abs() < 1e7)
        || !matches!(
            input.corner.as_str(),
            "top-left" | "top-right" | "bottom-left" | "bottom-right"
        )
    {
        return Err("小窗尺寸无效".into());
    }
    let width = if radio {
        184.0
    } else {
        b.width.round().clamp(200.0, 960.0)
    };
    let height = if radio {
        44.0
    } else {
        (width * 9.0 / 16.0).round()
    };
    Ok(Bounds {
        x: if input.corner.ends_with("left") {
            b.x + b.width - width
        } else {
            b.x
        },
        y: if input.corner.starts_with("top") {
            b.y + b.height - height
        } else {
            b.y
        },
        width,
        height,
    })
}
