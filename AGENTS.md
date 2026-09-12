# AGENTS.md

## 项目定位与架构

- 项目使用 Tauri 2 + Rust 后端、React + TypeScript 前端，由 Vite 构建前端资源。
- 本次是全新重写，保留现有界面与业务功能，不添加旧架构数据库、客户端存储或 JSON 整库备份的兼容逻辑；本次 Tauri 重写发布后的 SQLite 备份支持跨平台导入，并通过已知迁移升级。
- 当前目标为 macOS 14+、Windows 11，支持 arm64/x64；跨机器、实际播放与安装升级行为由维护者在目标设备验收。
- 前端的目录、组件、状态与编码细则见 [src/AGENTS.md](src/AGENTS.md)。架构说明见 [docs/tauri-rewrite.md](docs/tauri-rewrite.md)，发布配置见 [docs/tauri-release.md](docs/tauri-release.md)。

## 目录职责

- `src/`：React 前端；`platform/api` 封装 Rust 命令和事件，`types` 保存公共业务类型。前端路径别名 `@/` 指向 `src/`。
- `src-tauri/src/modules/`：业务模块。
- `src-tauri/src/infrastructure/`：数据库、网络、日志和媒体代理。
- `src-tauri/src/desktop/`：窗口、小窗和更新。
- `src-tauri/migrations/`：SQLite 结构迁移。
- `config/`：构建配置、版本检查与前端回归测试。
- `docs/`：架构、发布与组件补丁记录。
- `src-tauri/target/`、`src-tauri/gen/` 为生成目录，不提交到 Git。

## 数据边界

- 持久化业务数据统一由 Rust 管理；正式构建使用应用本地数据目录的 `data/data.db`，debug 构建使用 `development/data/data.db`，不自动搬移原数据。
- 已发布迁移（包括 `0001_initial.sql`）不可修改或删除，后续结构变更追加迁移。备份升级仅操作临时副本，较新或未知的迁移版本必须拒绝，不能忽略校验和强行恢复。
- 运行时缓存和临时状态保留在内存；日志独立存放在 `logs/`，不进入数据库或用户数据备份。
- 完整导出使用独立 SQLite 一致性快照，不能直接复制运行中的主 `.db` 文件代替备份，因为最新数据可能仍在 WAL 中。
- 源列表 JSON 继续用于外部源交换，与应用整库备份分开维护。

## 工具链与依赖

- 使用 pnpm；版本以 `package.json` 的 `packageManager` 为准，CI 读取同一字段。Node.js 主版本以 `.node-version` 为准，最低版本以 `engines` 为准，避免在文档重复维护具体版本号。
- Rust 使用 stable 工具链；macOS 需要 Xcode 开发工具，Windows 需要 MSVC C++ 开发工具及 WebView2。平台构建脚本在对应系统和工具链下运行。
- 依赖范围以 `package.json` 为准，实际安装版本由锁文件固定。新增依赖默认保存精确版本，升级需主动执行并验证；CI 使用冻结锁文件安装。
- 运行时库放入 `dependencies`，编译、CSS 处理、检查、类型声明与 CLI 工具放入 `devDependencies`。构建必须安装两类依赖，不能仅安装生产依赖。

## 开发与验证

- 可用命令以 `package.json` 的 `scripts` 为准；`pnpm dev` 启动 Tauri，`pnpm dev:web` 仅提供前端预览，不提供本机数据服务。
- `pnpm check` 执行应用版本、TypeScript、ESLint 和 Rust 编译检查；`pnpm test` 执行 Rust 与前端回归测试，部分 Rust 测试需要本机回环端口。
- `pnpm format:check` 检查前端与 Rust 格式；`pnpm lint:rust` 执行 Clippy 严格检查。按改动范围选择检查，纯文档修改不需要运行应用或业务测试。
- Tauri 构建钩子统一执行版本、类型检查及前端构建；不要通过其他入口绕开。`pnpm build:web` 只构建前端资源，`pnpm build:app` 只编译应用，不生成应用包或安装包。
- 不默认启动应用、操作桌面或进行长时间播放、打包及跨平台回归；不能用静态检查代替真实设备验收。
- 修改发布流程前核对 Tauri 签名配置与 GitHub workflow 的实际状态；编译通过不代表已签名、可自动更新或已发布。

## 文档边界

- README 面向用户介绍功能、下载与使用配置，不堆积详细开发命令、内部实现或 AI 协作要求。
- 项目开发约束维护在各级 AGENTS.md；架构细节、阶段进度与发布操作维护在 docs 中，避免多处重复维护。
