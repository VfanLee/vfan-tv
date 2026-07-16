# AGENTS.md

## 项目概览

`shared` 是 Vfan TV 的跨层共享模块，集中维护 main 与 renderer 共同依赖的类型、schema、常量和纯工具函数，确保跨进程数据契约一致，避免重复定义。

## 项目结构

```text

```

## 项目约定

修改内容时，同时检查 main 与 renderer 影响，并执行 `pnpm typecheck`。
