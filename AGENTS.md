# AGENTS.md

## 项目概览

**Vfan TV** 是一款免费开源、跨平台的桌面端影视聚合客户端（空壳）。

## 技术栈

按架构分层（细节以 `package.json` 为准）：

- 语言：TypeScript
- 桌面运行时：Electron
- 构建与分发：Electron Forge（Vite）、electron-updater
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
├── config/vite.*.config.ts   # main、preload 与 renderer 的 Vite 配置
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

## 重构约定

目前项目仍然处于开发阶段，暂不属于正式版，所以在重构时不需要考虑旧数据的兼容问题，直接让用户卸载重装即可。

## 测试约定

执行完任务之后，不需要编译、视觉回归等长耗时测试，进行简单的 typescript、eslint 检查即可。长耗时测试让开发者自行完成。
