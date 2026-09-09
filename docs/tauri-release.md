# Tauri 发布配置

## 当前状态

应用使用官方 updater 插件检查、下载、验证签名和安装，单实例插件在重复启动时唤起当前小窗或主窗口。更新清单固定使用本仓库 GitHub Releases 的 `tauri-latest.json`，仅使用 Tauri 更新清单格式。

当前配置的 `plugins.updater.pubkey` 为空，因此自动安装不可用。尚未生成正式签名密钥或发布更新清单，检查不存在的清单会报告失败，不会声称已是最新版。源代码中的下载和安装路径已接通；真实安装及升级回归仍需目标机器验收。

开发与打包脚本已统一为 Tauri。`.github/workflows/release.yml` 当前只支持手动触发四个目标的编译验证，不上传安装包、不发布 Release；签名配置完成后再启用正式发布。

## 正式发布前

1. 由维护者创建并备份 Tauri 更新签名密钥。私钥不进入源码、日志、公开构建产物或更新清单。
2. 将对应公钥填入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。公开仓库可保存公钥。
3. 构建时提供 `TAURI_SIGNING_PRIVATE_KEY`，若密钥加密则同时提供 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。GitHub Actions 应从仓库 Secrets 注入。
4. 启用 `bundle.createUpdaterArtifacts`，构建各平台的 Tauri 安装包及签名。macOS 应用签名/公证属于独立的系统分发配置，不等于 Tauri 更新签名。
5. 将所有目标的更新包和 `.sig` 上传到同一次 Release，然后生成 `tauri-latest.json`。目标键为 `darwin-aarch64`、`darwin-x86_64`、`windows-x86_64`、`windows-aarch64`；每项包含对应包的 HTTPS 地址及 `.sig` 文件内容。
6. 核对 package.json、Cargo.toml、tauri.conf.json 与 Release 标签的版本一致，再发布。更新清单仅包含对应目标的 Tauri 更新包。

公钥更换会影响旧安装对新包的信任，密钥需要长期保存。本阶段没有生成或上传任何私钥，也没有执行发布和真实安装。

## 本机未签名应用验证

已使用 `pnpm exec tauri build --bundles app --no-sign --ci -- --offline` 完成本机 Apple Silicon 的 Release 编译和 `.app` 打包。产物位于 `src-tauri/target/release/bundle/macos/Vfan TV.app`，架构 arm64、版本 0.11.1，Info.plist 与可执行文件最低系统版本均为 macOS 14.0。构建启用 custom-protocol，前端资源嵌入程序，不依赖开发服务器。没有启动、安装或发布该产物。

构建前自动校验三处应用版本；缺失或不一致会终止构建。未签名产物仅用于本机验证，正式分发仍需完成上面的签名与公证配置。

## 验证边界

本机测试使用 Tauri MockRuntime 和回环模拟清单，验证版本读取以及无效签名包被拒绝，不打开窗口、不安装软件。下载完成事件仅在插件验签成功后发送；检查与下载、安装串行，重复打开设置窗口可读取带版本号的当前更新状态。

参考：[Tauri 官方更新文档](https://v2.tauri.app/plugin/updater/)、[单实例文档](https://v2.tauri.app/plugin/single-instance/)。
