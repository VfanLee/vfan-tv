# AGENTS.md

## 介绍

跨平台桌面影视聚合播放器。

## 技术栈

- Node.js `>=22.12 <23`、pnpm `11.11.0`
- TypeScript `^5.9.3`
- Electron `39.2.6`、electron-vite `^5.0.0`、electron-builder `26.0.12`
- React `^19.2.1`、React Router `^7.17.0`、Zustand `^5.0.14`
- Tailwind CSS `^4.3.0`、shadcn `^4.12.0`、radix-ui `^1.6.0`
- SQLite：better-sqlite3 `^12.10.0`、Drizzle ORM `^0.45.2`、drizzle-kit `^0.31.10`
- ArtPlayer `5.4.0`、HLS.js `^1.6.16`

版本以 `package.json` 为准；修改依赖版本时同步更新本节。

## 项目目录

```text
.
├── src
│   ├── main                 # Electron main 进程、IPC、数据库、服务与仓储
│   ├── preload              # Electron preload 与 renderer 暴露类型
│   ├── renderer             # React renderer 应用
│   └── shared               # main 与 renderer 共享的类型、schema、常量和工具
├── docs                     # 项目维护文档与分域 agent 规范
├── components.json          # shadcn 配置
└── electron-builder.yml     # Electron Builder 配置
```

## 分域规则

必须按本次改动涉及的范围读取对应文档；跨域改动必须同时读取所有相关文档。

- 修改 `src/main`：读取 `docs/agents-main.md`
- 修改 `src/preload`：读取 `docs/agents-preload.md`
- 修改 `src/renderer`、`components.json` 或 shadcn 组件：读取 `docs/agents-renderer.md`
- 修改 `src/shared`：同时检查 main 与 renderer 影响，并执行 `pnpm typecheck`

## 通用规则

- 执行终端命令时应当优先使用 `zsh`。
- 实现时应当优先使用 `pnpm`、TypeScript 和项目既有技术栈。
- 涉及多种实现路径时应当先说明取舍；用户已给出具体方案时应当先评估方案合理性。
- 高风险操作必须先确认：`rm -rf`、系统配置修改、Shell 配置修改、删除数据库/数据文件、Git force push。
