# AGENTS.md

## 项目概览

**Vfan TV** 是一款免费开源、开箱即用的跨平台桌面端影视聚合播放器，基于 Electron 构建。项目由 main、preload、renderer 三个进程层以及 shared 共享层组成：main 负责应用生命周期、本地数据与业务能力，preload 负责安全地桥接进程能力，renderer 提供 React 用户界面，shared 维护跨层通用的类型、schema、常量与工具。

## 技术栈

- TypeScript
- Electron、electron-vite、electron-builder
- better-sqlite3、Drizzle ORM
- React、React Router、Zustand
- Tailwind CSS、shadcn-ui
- ArtPlayer、HLS.js、mpegts.js

实际以 package.json 为准。

## 项目环境

- Node.js 22
- pnpm 11

## 项目结构

```text
├── src
│   ├── main                 # Electron main
│   ├── preload              # Electron preload
│   ├── renderer             # Electron renderer
│   └── shared               # main 与 renderer 共享的类型、schema、常量和工具
├── components.json          # shadcn 配置
└── electron-builder.yml     # Electron Builder 配置
```

## 常用命令

```bash
# 安装依赖
pnpm install

# 本地开发与预览
pnpm dev
pnpm start

# 代码检查与格式化
pnpm typecheck
pnpm lint
pnpm format

# 构建与打包
pnpm build
pnpm build:dir
pnpm build:mac
pnpm build:mac:arm64
pnpm build:win
pnpm build:win:x64
pnpm build:win:arm64

# 生成 Drizzle 数据库迁移文件
pnpm db:generate
```
