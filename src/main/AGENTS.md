# AGENTS.md

## 项目概览

`main` 是 Vfan TV 的 Electron 主进程模块，负责应用生命周期与窗口管理，并承载本地 SQLite 数据访问、核心业务服务、媒体处理及 IPC 能力，为 renderer 提供桌面端业务支撑。

## 项目结构

```text
main
├── db              # SQLite/Drizzle client 与 schema
├── ipc             # IPC handler 注册
├── repositories    # 数据访问层
├── services        # main 进程业务服务
└── index.ts        # main 进程入口
```

## 命名与规则

### index.ts

- `main/index.ts` 必须作为 main 进程入口，负责应用生命周期、窗口初始化与模块装配。

### db

- `db` 目录应当维护 SQLite/Drizzle 的 client 与 schema。
- 修改 schema 后，必须同步检查 repositories、IPC 返回结构和 renderer 调用方是否需要更新。

### ipc

- IPC handler 必须在 `ipc/register-handlers.ts` 统一注册。
- 新增或调整 IPC 通道时，应当优先复用 `src/shared` 的类型与 schema。

### repositories

- repository 应当只负责数据访问，不承载 UI 语义和跨层业务流程。
- 修改 repository 的输入输出后，必须同步检查 IPC 与 `src/shared` 类型定义。

### services

- services 应当负责 main 侧业务编排与基础能力封装。
- 服务间调用应当通过明确的参数与返回值传递，不依赖 renderer 模块。

### 跨域边界

- main 进程代码不得直接依赖 renderer 模块。
- 跨进程数据结构应当优先放在 `src/shared`，避免 main 与 renderer 各自维护重复类型。
- 修改 `src/shared` 后必须执行 `pnpm typecheck`。
