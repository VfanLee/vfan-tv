# AGENTS.md

## 项目概览

`main` 是 Vfan TV 的 Electron 主进程模块，负责应用生命周期与窗口管理，并承载本地 SQLite 数据访问、核心业务服务、媒体处理及 IPC 能力，为 renderer 提供桌面端业务支撑。

## 项目结构

```text
main
├── app             # 启动流程、菜单与组合根
├── infrastructure  # 数据库、HTTP、外链等跨领域基础能力
├── ipc             # 跨领域 IPC 聚合与窗口/Shell 能力
├── modules         # 按业务领域组织的 repository、service 与 IPC handler
├── windows         # BrowserWindow 创建及窗口安全策略
└── index.ts        # 仅加载 app/bootstrap 的 main 进程入口
```

## 命名与规则

### index.ts

- `main/index.ts` 必须作为 main 进程入口，保持极薄，只负责加载启动模块。
- 应用生命周期、菜单初始化和启动协调应放在 `app/bootstrap.ts`。

### app 与组合根

- `app/composition-root.ts` 是唯一的依赖装配位置，负责创建数据库、repository、service、事件发送器和窗口访问器。
- 领域模块不得自行创建数据库连接或隐藏的全局单例；应通过明确参数接收所需依赖。

### infrastructure

- `infrastructure` 仅存放不属于单一业务领域的技术实现，例如 SQLite/Drizzle、HTTP 与外链能力。
- 修改数据库 schema 后，必须同步检查相关领域模块、IPC 返回结构和 renderer 调用方。

### modules

- 新功能按业务领域创建 `modules/<domain>/`，将该领域的 repository、service 和 `ipc.ts` 就近放置。
- repository 只负责数据访问；service 负责领域编排；IPC handler 仅负责参数接收、调用 service 和返回结果。
- 跨领域流程应由专属模块（如 `app-data`）或 app 层协调，不应反向依赖 renderer。

### ipc 与 windows

- `ipc/register-handlers.ts` 只聚合各领域注册器，不放置具体业务 handler。
- IPC 通道必须使用 `@shared/ipc` 的 `IPC_CHANNELS`；通道类型与跨进程结构优先复用 `src/shared`。
- BrowserWindow 创建、导航限制和窗口相关策略放在 `windows/`；IPC 通过组合根提供的窗口访问器操作窗口。

### 跨域边界

- main 进程代码不得直接依赖 renderer 模块。
- 跨进程数据结构应当优先放在 `src/shared`，避免 main 与 renderer 各自维护重复类型。
- 修改 `src/shared` 后必须执行 `pnpm typecheck`。
