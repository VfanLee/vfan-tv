# Main agent guide

## 范围

适用于 `src/main` 下的 Electron main 进程代码，包括 IPC 注册、数据库、仓储、服务、更新检查、媒体代理等。

## 目录

```text
src/main
├── db              # SQLite/Drizzle client 与 schema
├── ipc             # IPC handler 注册
├── repositories    # 数据访问层
├── services        # main 进程业务服务
└── index.ts        # main 进程入口
```

## 约定

- main 进程代码不要直接依赖 renderer 模块。
- 跨进程数据结构优先放在 `src/shared`，避免 main 与 renderer 各自维护重复类型。
- 修改数据库 schema、repository 或 IPC 返回结构时，检查 renderer 调用方和 `src/shared` 类型/schema 是否需要同步。
- 修改 `src/shared` 后必须执行 `pnpm typecheck`。
