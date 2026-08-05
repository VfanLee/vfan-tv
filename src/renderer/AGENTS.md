# AGENTS.md

## 项目概览

`renderer` 是 Vfan TV 的渲染进程前端模块，基于 React 构建桌面应用界面。

## 项目结构

```text
renderer
├── app          # renderer 启动、路由、Provider 与应用组装
├── features     # 按路由与业务领域组织的页面、私有组件和 hooks
├── platform     # preload API client、缓存与播放基础能力
├── components   # 跨领域公共组件
├── assets       # 静态资源
├── constants    # 公共常量
├── hooks        # 稳定的跨领域 hooks
├── stores       # 跨领域 Zustand stores
├── styles       # 全局样式与主题变量
├── ui           # shadcn 生成的组件
└── utils        # 通用工具
```

## 项目约定

### 模块拆分通则

- 避免将过多 UI、状态、副作用或业务逻辑堆积在单个文件中；当内容变复杂时，应按职责拆分为命名明确的私有模块。
- 私有模块优先就近放在当前业务目录，例如 `components/`、`hooks/`、`types.ts`、`utils.ts`；入口文件只负责组装和协调。
- 不为形式化拆分或潜在复用过早抽象；只有跨业务域实际复用且语义稳定时，才提升到 renderer 全局目录。

### components

- 公共组件必须使用英文小写命名；多单词使用 kebab-case，并以“目录 + `index.tsx`”形式创建，例如 `foo/index.tsx`、`foo-bar/index.tsx`。
- `components/index.ts` 统一导出公共组件（使用方必须从此处导入；新增/移动/删除需同步维护）。

### constants

- 公共常量文件必须使用英文小写命名；多单词使用 kebab-case，例如 `foo.ts`、`foo-bar.ts`。
- `constants/index.ts` 统一导出公共常量（使用方必须从此处导入；新增/移动/删除需同步维护）。

### hooks

- 公共 hooks 必须使用英文小写命名；多单词使用 kebab-case，并以 `use-` 开头，例如 `use-foo.ts`、`use-foo-bar.ts`。
- `hooks/index.ts` 统一导出公共 hooks（使用方必须从此处导入；新增/移动/删除需同步维护）。

### features

- 路由页面必须使用英文小写命名；多单词使用 kebab-case，并以“目录 + `index.tsx`”形式创建，例如 `foo/index.tsx`、`foo-bar/index.tsx`。
- `features/index.ts` 统一导出所有路由页面（使用方必须从此处导入；新增/移动/删除需同步维护）。
- 页面专属组件、hooks、类型与工具必须就近放在所属 feature 内。

### platform

- `platform/api` 用于 preload 接口调用与数据访问封装；缓存、播放等 renderer 技术能力也归入 platform。
- API 文件必须使用英文小写命名；多单词使用 kebab-case，例如 `foo.ts`、`foo-bar.ts`。
- `platform/api/index.ts` 统一导出所有 API 函数（使用方必须从此处导入；新增/移动/删除需同步维护）。

### stores

- store 文件必须使用英文小写命名；多单词使用 kebab-case，例如 `foo.ts`、`foo-bar.ts`。
- `stores/index.ts` 统一导出所有 store（使用方必须从此处导入；新增/移动/删除需同步维护）。

### utils

- 工具函数文件必须使用英文小写命名；多单词使用 kebab-case，例如 `foo.ts`、`foo-bar.ts`。
- `utils/index.ts` 统一导出所有工具函数（使用方必须从此处导入；新增/移动/删除需同步维护）。

### shadcn

- 在项目根目录使用 `pnpm exec shadcn add <component>` 添加或更新组件；当前生成目录为 `src/renderer/ui`。
- 根目录下 `components.json` 约定的 shadcn 生成文件默认不得直接修改，应当按依赖代码使用，避免后续升级与维护成本。
- 修改 `components.json` 前，必须先确认不会影响后续生成路径或现有 import。
- `ui` 下的生成组件应遵循 `components.json` 的别名配置；其中 `@/utils/cn` 是 shadcn 对工具函数文件的固定引用，无需改为 `utils/index.ts` 聚合入口。
- 若生成组件不满足业务需求，应当优先在业务组件目录中复制或二次封装实现（如 `components/button/index.tsx`）。
- 仅在确有必要时修改原始生成文件内容时；修改后必须记录到 `src/renderer/docs/shadcn-patches.md`，便于后续迁移。
