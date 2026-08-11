# AGENTS.md

## 项目概览

**Vfan TV** 是一款免费开源、跨平台的桌面端影视聚合客户端（空壳）。

## 技术栈

按架构分层（细节以 `package.json` 为准）：

- 语言：TypeScript
- 桌面运行时：Electron
- 构建与分发：Electron Forge（Webpack）、electron-updater
- 数据层：better-sqlite3、Drizzle ORM、Zod
- 渲染层：React、React Router、Zustand、Tailwind CSS、shadcn/ui
- 播放层：ArtPlayer、hls.js、mpegts.js

## 项目环境

- Node.js 24 LTS
- pnpm 11

## 项目结构

```text
├── src
│   ├── main                 # main
│   ├── preload              # preload
│   ├── renderer             # renderer
│   └── shared               # 共享层
├── config/webpack            # Webpack 配置
├── components.json          # shadcn 配置
└── forge.config.ts           # Forge 配置
```

## 注释约定

- 单条内容的 JSDoc 使用 `/** 内容 */` 单行格式
- 包含多条说明、参数或分段内容的 JSDoc 才使用多行格式
- JSDoc 内容行末不加句号

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

# 构建、打包与发布
pnpm package
pnpm make:win
pnpm make:mac
pnpm make:mac:arm64
pnpm make:mac:x64
pnpm make:win:x64
pnpm make:win:arm64
pnpm publish:mac:arm64
pnpm publish:mac:x64
pnpm publish:win:x64
pnpm publish:win:arm64

# 生成 Drizzle 数据库迁移文件
pnpm db:generate
```
