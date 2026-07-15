# Renderer agent rules

## 适用范围

适用于 `src/renderer`、`components.json`、shadcn 组件和 renderer 侧维护文档。

## 目录结构

```text
src/renderer/src
├── assets       # 全局样式与静态资源
├── components   # renderer 组件
│   ├── common   # 通用业务组件
│   ├── layout   # 布局与设置类业务组件
│   ├── media    # 播放、海报等媒体业务组件
│   └── ui       # shadcn 生成组件，保持默认单文件结构
├── hooks        # 公共 hooks
├── pages        # 路由页面
├── routes       # React Router 配置
├── services     # renderer API 与业务服务封装
├── stores       # Zustand stores
└── utils        # renderer 通用工具
```

## 命名与规则

### 模块拆分通则

- 模块应保持单一、清晰的职责。只要一段 UI、状态管理、副作用、领域逻辑、类型定义或纯数据转换具有独立语义，且抽取能提升可读性、可测试性、可维护性或复用边界，就应拆分为命名明确的私有模块；这是一项通用设计原则，而非仅针对组件或页面的规则。
- 优先在当前业务域就近组织：可在现有目录下新建 `components/`、`hooks/`、`types.ts`、`utils.ts`、`services/` 等私有模块。对外入口文件只负责组装、协调与导出，私有模块默认直接导入具体文件，不建立无必要的聚合出口。
- 不为形式化拆分，也不为了潜在复用过早抽象；只有跨业务域实际复用且语义稳定时，才提升到 renderer 全局目录。

### components

- 业务组件目录必须统一使用小写烧烤串命名，采用 `xxx-yyy/index.tsx`。
- `common`、`layout`、`media` 下新增组件时必须遵循同一规则。
- `components/index.ts` 作为聚合导出入口，新增组件时必须同步维护。

### pages

- 页面目录必须统一使用小写烧烤串命名，采用 `xxx-yyy/index.tsx`。
- `pages/index.ts` 作为聚合导出入口，新增页面时必须同步维护。
- `index.tsx` 应当聚焦路由页面布局、模块组合和路由级协调，不应长期混合大量子组件、领域状态、副作用与纯数据转换。
- 页面私有 UI 放在页面目录的 `components/` 下，采用小写烧烤串单文件命名，例如 `components/source-table-card.tsx`。
- 页面私有 hooks 放在页面目录的 `hooks/` 下，采用 `use-xxx-yyy.ts` 命名；应按稳定的业务行为或状态域拆分，避免创建返回大量无关状态和操作的“万能 hook”。
- 页面私有类型与纯函数可以放在 `types.ts`、`utils.ts`，或在内容较多时使用含义明确的小写烧烤串文件名。
- 页面私有模块应直接导入具体文件，默认不增加页面内部聚合导出，以降低循环依赖和无效打包风险。
- 只有跨页面或跨组件实际复用、且语义稳定的能力，才提升到 renderer 全局 `components`、`hooks` 或 `utils` 目录。

### hooks

- 公共 hooks 必须统一使用小写烧烤串单文件命名，采用 `xxx-yyy.ts`。
- 公共 hooks 必须从 `src/renderer/src/hooks/index.ts` 导出。
- 公共 hooks 应当只提取跨页面或跨组件复用、语义稳定的能力。

### services

- 服务文件必须统一使用小写烧烤串单文件命名。
- `services/api` 用于接口请求与数据访问封装，新增 API 模块时必须从 `services/api/index.ts` 导出。
- `services/index.ts` 作为聚合导出入口，新增公共服务时必须同步维护。

### stores

- stores 必须统一使用小写烧烤串单文件命名。
- 每个 store 应当聚焦单一状态域，避免把无关状态合并到同一个 store。

### utils

- utils 必须统一使用小写烧烤串单文件命名。

### shadcn

- `components.json` 约定的 shadcn 生成文件默认不得直接修改，应当按依赖代码使用，避免后续升级与维护成本。
- 修改 `components.json` 前，必须先确认不会影响后续生成路径或现有 import。
- 若生成组件不满足业务需求，应当优先在业务组件目录中复制或二次封装实现（如 `components/button/index.tsx`）。
- 仅在确有必要时修改原始生成文件；修改后必须记录到 `docs/shadcn-patches.md`，便于后续迁移。
