# Renderer agent guide

## 范围

适用于 `src/renderer`、`components.json`、shadcn 组件和 renderer 侧维护文档。

## 目录

```text
src/renderer/src
├── assets       # 全局样式与静态资源
├── components   # renderer 组件
│   ├── common   # 通用业务组件，使用 ComponentName/index.tsx
│   ├── layout   # 布局与设置类业务组件，使用 ComponentName/index.tsx
│   ├── media    # 播放、海报等媒体业务组件，使用 ComponentName/index.tsx
│   └── ui       # shadcn 生成组件，保持默认单文件结构
├── hooks        # 公共 hooks，使用 use-xxx/index.ts
├── pages        # 路由页面，使用 PageName/index.tsx
├── routes       # React Router 配置
├── services     # renderer API 与业务服务封装
├── stores       # Zustand stores
└── utils        # renderer 通用工具，包含 shadcn cn.ts
```

## 目录规范

- 页面组件使用目录入口：`src/renderer/src/pages/AboutPage/index.tsx`，不要新增 `src/renderer/src/pages/AboutPage.tsx` 这类单文件页面。
- 自定义业务组件使用目录入口：`src/renderer/src/components/common/ConfirmDialog/index.tsx`。`components/common`、`components/layout`、`components/media` 下新增组件时优先采用 `ComponentName/index.tsx`。
- `src/renderer/src/components/ui` 为 shadcn 生成组件目录，保持 shadcn 默认文件形态，不按业务组件目录入口规则迁移。
- 公共 hooks 放在 `src/renderer/src/hooks/use-xxx/index.ts`，并从 `src/renderer/src/hooks/index.ts` 导出。只提取跨页面/跨组件复用且语义稳定的 hook，不为了目录完整性过早抽象。
- renderer 通用工具放在 `src/renderer/src/utils`。业务代码不要再新增或引用 `src/renderer/src/lib`。
- shadcn 的 `cn` 工具固定放在 `src/renderer/src/utils/cn.ts`，对应 `components.json` 的 `aliases.utils` 为 `@/utils/cn`。
- 业务代码引用工具时优先使用 `@renderer/utils/...`，shadcn 生成组件引用 `cn` 使用 `@/utils/cn`。
- `pages/index.ts`、`components/index.ts`、`hooks/index.ts` 作为聚合导出入口，新增页面、组件、公共 hook 时同步维护。

## shadcn

- shadcn 生成文件视为可再生代码，除非明确要求更新或修复 shadcn 组件，否则不要直接修改：`components.json` 以及其定义的文件。
- 修改 `components.json` 中的 aliases、style、baseColor、css、tailwind 等配置前，必须确认不会影响后续 shadcn 组件生成路径或现有 import。
- UI 定制优先通过 `className`、业务组合组件或包装层实现，不要为了样式调整直接修改 shadcn 默认文件。
- 如确实需要修改 shadcn 默认文件，必须说明修改原因，并在 `docs/shadcn-patches.md` 记录变更内容及后续升级恢复方式。
- 更新或新增 shadcn 组件后，确认生成代码中的工具引用使用 `@/utils/cn`，不要恢复为 `@/lib/utils`。
