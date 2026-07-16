# AGENTS.md

## 项目概览

`shared` 是 Vfan TV 的跨层共享模块，集中维护 main 与 renderer 共同依赖的类型、schema、常量和纯工具函数，确保跨进程数据契约一致，避免重复定义。

## 项目结构

```text
shared
├── constants       # 跨层常量
├── ipc             # IPC channel 契约
├── schemas         # 运行时数据校验 schema
├── types           # 跨层 TypeScript 类型
└── utils           # 无进程副作用的纯工具函数
```

## 项目约定

- `ipc/IPC_CHANNELS` 是 main 与 preload 的唯一 IPC channel 来源；新增或修改 channel 时同步检查两端注册与暴露实现。
- shared 不得依赖 main、preload 或 renderer，也不得引入 Electron 运行时能力。
- 修改内容时，同时检查 main 与 renderer 影响，并执行 `pnpm typecheck`。
