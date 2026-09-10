//! 数据传输入口；文件恢复与清理分别维护完整事务。
mod clear;
mod commands;
mod snapshot;
#[cfg(test)]
mod tests;

pub use clear::*;
pub use commands::*;

use serde::Serialize;

/// 串行执行数据库文件操作，避免多个窗口同时恢复
#[derive(Default)]
pub struct DataTransfer(pub tokio::sync::Mutex<()>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferResult {
    cancelled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    safety_backup_path: Option<String>,
}

/// 生成取消结果，不改变当前数据
fn cancelled() -> TransferResult {
    TransferResult {
        cancelled: true,
        file_path: None,
        safety_backup_path: None,
    }
}
