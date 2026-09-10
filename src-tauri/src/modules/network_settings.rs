use crate::infrastructure::diagnostics::command_error;
use crate::infrastructure::network::{self, NetworkMode};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use std::collections::HashSet;
use tauri::{Emitter, State};

#[derive(Clone, Deserialize, Serialize, FromRow)]
pub struct ProxyProfile {
    id: String,
    name: String,
    protocol: String,
    host: String,
    port: u16,
}

#[derive(Clone, Deserialize, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Route {
    mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    active_profile_id: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct NetworkSettings {
    profiles: Vec<ProxyProfile>,
    iptv: Route,
}

/// 校验代理地址和路由引用，禁止保存不可用的自定义路由
fn validate(settings: &mut NetworkSettings) -> Result<(), String> {
    let mut ids = HashSet::new();
    for profile in &mut settings.profiles {
        profile.name = profile.name.trim().to_owned();
        profile.host = profile.host.trim().to_owned();
        if profile.id.trim().is_empty()
            || !ids.insert(profile.id.clone())
            || profile.name.is_empty()
            || profile.port == 0
        {
            return Err("代理名称、标识或端口无效".to_owned());
        }
        if !matches!(profile.protocol.as_str(), "http" | "https" | "socks5") {
            return Err("不支持的代理协议".to_owned());
        }
        // 使用 URL 库校验主机，避免将路径、凭据或查询参数混入代理地址
        let host = reqwest::Url::parse("http://localhost")
            .and_then(|mut url| {
                url.set_host(Some(&profile.host))?;
                Ok(url)
            })
            .map_err(|_| "代理主机无效")?;
        if profile.host.is_empty()
            || profile.host.contains(['/', '?', '#', '@'])
            || host.host_str().is_none()
        {
            return Err("代理主机无效".to_owned());
        }
    }
    if !matches!(settings.iptv.mode.as_str(), "direct" | "system" | "custom") {
        return Err("网络模式无效".to_owned());
    }
    if settings
        .iptv
        .active_profile_id
        .as_ref()
        .is_some_and(|id| !ids.contains(id))
    {
        return Err("所选代理不存在".to_owned());
    }
    if settings.iptv.mode == "custom" && settings.iptv.active_profile_id.is_none() {
        return Err("请选择自定义代理".to_owned());
    }
    Ok(())
}

/// 从数据库读取代理列表与直播路由的同一快照
pub async fn read(db: &SqlitePool) -> Result<NetworkSettings, String> {
    let mut tx = db
        .begin()
        .await
        .map_err(|error| command_error("无法读取网络配置", &error))?;
    let profiles =
        sqlx::query_as("SELECT id,name,protocol,host,port FROM proxy_profiles ORDER BY sort,id")
            .fetch_all(&mut *tx)
            .await
            .map_err(|error| command_error("读取代理配置失败", &error))?;
    let iptv =
        sqlx::query_as("SELECT mode,active_profile_id FROM network_routes WHERE route='iptv'")
            .fetch_one(&mut *tx)
            .await
            .map_err(|error| command_error("读取直播路由失败", &error))?;
    tx.commit()
        .await
        .map_err(|error| command_error("读取网络配置失败", &error))?;
    Ok(NetworkSettings { profiles, iptv })
}

/// 原子替换代理配置，任何失败均保留原配置
async fn save(db: &SqlitePool, mut settings: NetworkSettings) -> Result<NetworkSettings, String> {
    validate(&mut settings)?;
    let mut tx = db
        .begin()
        .await
        .map_err(|error| command_error("无法开始网络配置修改", &error))?;
    // 先回退到直连再清空代理，避免中间状态违反 custom 必须指向代理的约束
    sqlx::query(
        "UPDATE network_routes SET mode='direct',active_profile_id=NULL WHERE route='iptv'",
    )
    .execute(&mut *tx)
    .await
    .map_err(|error| command_error("更新网络路由失败", &error))?;
    sqlx::query("DELETE FROM proxy_profiles")
        .execute(&mut *tx)
        .await
        .map_err(|error| command_error("更新代理配置失败", &error))?;
    for (index, profile) in settings.profiles.iter().enumerate() {
        sqlx::query(
            "INSERT INTO proxy_profiles(id,name,protocol,host,port,sort) VALUES(?,?,?,?,?,?)",
        )
        .bind(&profile.id)
        .bind(&profile.name)
        .bind(&profile.protocol)
        .bind(&profile.host)
        .bind(i64::from(profile.port))
        .bind(index as i64)
        .execute(&mut *tx)
        .await
        .map_err(|error| command_error("保存代理配置失败", &error))?;
    }
    sqlx::query("UPDATE network_routes SET mode=?,active_profile_id=? WHERE route='iptv'")
        .bind(&settings.iptv.mode)
        .bind(&settings.iptv.active_profile_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| command_error("保存直播路由失败", &error))?;
    tx.commit()
        .await
        .map_err(|error| command_error("提交网络配置失败", &error))?;
    Ok(settings)
}

/// 返回数据库中的网络配置
#[tauri::command]
pub async fn get_network_settings(db: State<'_, SqlitePool>) -> Result<NetworkSettings, String> {
    read(&db).await
}

/// 保存配置后通知各窗口刷新
#[tauri::command]
pub async fn save_network_settings(
    app: tauri::AppHandle,
    db: State<'_, SqlitePool>,
    settings: NetworkSettings,
) -> Result<NetworkSettings, String> {
    let result = save(&db, settings).await?;
    if let Err(error) = app.emit("app-data-changed", "settings") {
        log::warn!("网络配置通知失败: {error}");
    }
    Ok(result)
}

/// 按配置创建直播请求客户端，自定义代理不继承系统代理
pub fn client(settings: &NetworkSettings) -> Result<reqwest::Client, String> {
    let mut checked = settings.clone();
    validate(&mut checked)?;
    match checked.iptv.mode.as_str() {
        "system" => network::create_client(&NetworkMode::System),
        "custom" => {
            let profile = checked
                .profiles
                .iter()
                .find(|profile| Some(&profile.id) == checked.iptv.active_profile_id.as_ref())
                .ok_or("所选代理不存在")?;
            let mut url = reqwest::Url::parse(&format!("{}://localhost", profile.protocol))
                .map_err(|_| "代理地址无效")?;
            url.set_host(Some(&profile.host))
                .map_err(|_| "代理主机无效")?;
            url.set_port(Some(profile.port))
                .map_err(|_| "代理端口无效")?;
            let proxy = reqwest::Proxy::all(url.as_str()).map_err(|_| "代理地址无效")?;
            network::client_builder()
                .no_proxy()
                .proxy(proxy)
                .build()
                .map_err(|_| "初始化代理客户端失败".to_owned())
        }
        _ => network::create_client(&NetworkMode::Direct),
    }
}

#[derive(Deserialize)]
pub struct TestInput {
    route: String,
    settings: NetworkSettings,
}

/// 用临时配置测试直播网络，不改变已保存的设置
#[tauri::command]
pub async fn test_network_settings(input: TestInput) -> Result<serde_json::Value, String> {
    if input.route != "iptv" {
        return Err("不支持的网络路由".to_owned());
    }
    let client = client(&input.settings)?;
    let start = std::time::Instant::now();
    let result = network::request(
        &client,
        reqwest::Method::GET,
        network::parse_http_url("https://www.gstatic.com/generate_204")?,
        Default::default(),
    )
    .await;
    let error = match result {
        Ok(response) if response.status().is_success() => None,
        Ok(response) => Some(format!("测试地址返回 HTTP {}", response.status().as_u16())),
        Err(error) => Some(error),
    };
    Ok(
        serde_json::json!({"status":if error.is_none(){"success"}else{"error"},"elapsedMs":start.elapsed().as_millis(),"route":input.settings.iptv.mode,"errorMessage":error}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    /// 无效的路由引用不能覆盖已有代理配置
    #[tokio::test]
    async fn invalid_update_preserves_network_settings() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&db).await.unwrap();
        let mut settings = read(&db).await.unwrap();
        settings.profiles.push(ProxyProfile {
            id: "local".into(),
            name: "Local".into(),
            protocol: "http".into(),
            host: "127.0.0.1".into(),
            port: 7890,
        });
        settings.iptv = Route {
            mode: "custom".into(),
            active_profile_id: Some("local".into()),
        };
        save(&db, settings.clone()).await.unwrap();
        for protocol in ["http", "https", "socks5"] {
            settings.profiles[0].protocol = protocol.into();
            assert!(client(&settings).is_ok(), "{protocol}");
        }
        settings.profiles.clear();
        assert!(save(&db, settings).await.is_err());
        let retained = read(&db).await.unwrap();
        assert_eq!(retained.profiles.len(), 1);
        assert_eq!(retained.iptv.active_profile_id.as_deref(), Some("local"));
        db.close().await;
    }
}

/// 读取路由配置和本机可用的 IP 路由，不发起外部连通性请求
#[tauri::command]
pub async fn get_network_status(db: State<'_, SqlitePool>) -> Result<serde_json::Value, String> {
    let settings = read(&db).await?;
    let active_name = settings
        .profiles
        .iter()
        .find(|profile| Some(&profile.id) == settings.iptv.active_profile_id.as_ref())
        .map(|profile| &profile.name);
    let mut families = Vec::new();
    for (bind, target, family) in [
        ("0.0.0.0:0", "1.1.1.1:53", "ipv4"),
        ("[::]:0", "[2606:4700:4700::1111]:53", "ipv6"),
    ] {
        if std::net::UdpSocket::bind(bind)
            .and_then(|socket| {
                socket.connect(target)?;
                socket.local_addr()
            })
            .is_ok()
        {
            families.push(family);
        }
    }
    Ok(
        serde_json::json!({"online":!families.is_empty(),"ipFamilies":families,"systemProxyStatus":"unknown","routes":{"iptv":{"mode":settings.iptv.mode,"activeProfileId":settings.iptv.active_profile_id,"activeProfileName":active_name}}}),
    )
}

/// 描述直播会话实际使用的路由快照
pub fn route_label(settings: &NetworkSettings) -> String {
    match settings.iptv.mode.as_str() {
        "system" => "系统代理".into(),
        "custom" => settings
            .profiles
            .iter()
            .find(|profile| Some(&profile.id) == settings.iptv.active_profile_id.as_ref())
            .map(|profile| format!("自定义代理：{}", profile.name))
            .unwrap_or_else(|| "自定义代理".into()),
        _ => "直连".into(),
    }
}
