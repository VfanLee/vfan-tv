//! 源管理的公共类型、命令入口及变更通知。
mod commands;
mod exchange;
mod repository;
mod speed_test;
mod subscriptions;

pub use commands::*;
pub use exchange::*;
pub use repository::{find, list};
pub use speed_test::*;
pub use subscriptions::*;

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use std::collections::BTreeMap;
use tauri::Emitter;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    Vod,
    Iptv,
}

impl SourceKind {
    /// 返回数据库中稳定的源类型标识
    fn key(self) -> &'static str {
        match self {
            Self::Vod => "vod",
            Self::Iptv => "iptv",
        }
    }
}

#[derive(Clone, Deserialize, Serialize, PartialEq)]
pub struct SourceInput {
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub backups: Vec<String>,
}

#[derive(Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub name: String,
    pub url: String,
    pub disabled: bool,
    #[sqlx(json)]
    pub headers: BTreeMap<String, String>,
    #[sqlx(json)]
    pub backups: Vec<String>,
    pub sort: i64,
    /// 为空表示手动添加，否则指向来源订阅
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscription_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remark: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 通知各窗口刷新源列表
fn notify(app: &tauri::AppHandle, kind: SourceKind) {
    let domain = match kind {
        SourceKind::Vod => "vod-sources",
        SourceKind::Iptv => "iptv-sources",
    };
    if let Err(error) = app.emit("app-data-changed", domain) {
        log::warn!("源变更通知失败: {error}");
    }
}

/// 源删除提交后通知全部窗口重新读取被触发器清理的选择偏好
fn notify_selections(app: &tauri::AppHandle) {
    if let Err(error) = app.emit("ui-preferences-changed", ()) {
        log::warn!("源选择通知失败: {error}");
    }
}
