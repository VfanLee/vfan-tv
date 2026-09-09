# AGENTS.md

## 项目概览

`src` 是 Vfan TV 的 React / TypeScript 前端，在 Tauri WebView 中运行。重构期间保留现有界面与功能，后端由 Rust 实现；已确认的架构和阶段进度见 `../docs/tauri-rewrite.md`。

## 项目结构

```text
src
├── app          # 前端启动、路由、Provider 与应用组装
├── pages        # 路由页面及其私有组件、hooks、类型与工具
├── platform     # Tauri 通信、内存缓存与播放基础能力
├── components   # 跨领域公共组件
├── assets       # 静态资源
├── types        # 公共业务类型
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
- 通用逻辑优先使用标准 API 或适用的成熟工具库；前端继续按需使用 dayjs、es-toolkit 等现有依赖。
- 引入依赖应确实减少重复实现、错误风险或维护成本，避免职责重叠的库及没有业务含义的二次封装。

### components

- 公共组件必须使用英文小写命名；多单词使用 kebab-case，并以“目录 + `index.tsx`”形式创建，例如 `foo/index.tsx`、`foo-bar/index.tsx`。
- `components/index.ts` 统一导出公共组件（使用方必须从此处导入；新增/移动/删除需同步维护）。

### constants

- 公共常量文件必须使用英文小写命名；多单词使用 kebab-case，例如 `foo.ts`、`foo-bar.ts`。
- `constants/index.ts` 统一导出公共常量（使用方必须从此处导入；新增/移动/删除需同步维护）。

### hooks

- 公共 hooks 必须使用英文小写命名；多单词使用 kebab-case，并以 `use-` 开头，例如 `use-foo.ts`、`use-foo-bar.ts`。
- `hooks/index.ts` 统一导出公共 hooks（使用方必须从此处导入；新增/移动/删除需同步维护）。

### pages

- 路由页面必须使用英文小写命名；多单词使用 kebab-case，并以“目录 + `index.tsx`”形式创建，例如 `foo/index.tsx`、`foo-bar/index.tsx`。
- `pages/index.ts` 统一导出所有路由页面（使用方必须从此处导入；新增/移动/删除需同步维护）。
- 页面入口以组装和协调为主；当页面包含多个独立 UI 区块、状态逻辑或业务职责时，适当拆分到页面目录内的 `components/`、`hooks/`、`types.ts`、`utils.ts` 等私有模块。
- 简单页面无需为目录形式强制拆分；页面专属实现应就近放在所属 page 内，只有跨页面实际复用且语义稳定时才提升到前端全局目录。
- 每个页面组件、页面目录内的命名函数、命名回调、组件、hook 与工具函数都必须使用 `/** */` JSDoc 说明职责；匿名内联回调无需逐个添加注释。
- 重要的模块级常量、配置、缓存状态，以及承担关键业务含义的派生变量必须使用 `/** */` JSDoc 说明用途。
- 注释应直接说明执行动作、处理对象、返回结果或副作用，不解释采用当前写法的原因，也不只复述名称。
- 前端中的每个 `useEffect` 必须在调用前使用 `/** */` JSDoc 说明它执行的副作用；单行 JSDoc 末尾不加句号。

### platform

- `platform/api` 用于业务命令调用与数据访问封装；Tauri 通信、内存缓存、播放等前端技术能力归入 platform。
- 页面和 store 通过 platform 调用 Rust，避免直接散布 `invoke`、事件订阅及底层命令名；事件订阅在组件卸载或任务结束时释放。
- 桌面能力统一通过 Tauri 调用 Rust，不引入 Node.js 运行时，不伪造成功结果。
- 前端不直接访问 SQLite；参数类型和返回类型需与 Rust 契约一致，TypeScript 类型声明不能替代后端校验。
- API 文件必须使用英文小写命名；多单词使用 kebab-case，例如 `foo.ts`、`foo-bar.ts`。
- `platform/api/index.ts` 统一导出所有 API 函数（使用方必须从此处导入；新增/移动/删除需同步维护）。

### stores

- store 文件必须使用英文小写命名；多单词使用 kebab-case，例如 `foo.ts`、`foo-bar.ts`。
- `stores/index.ts` 统一导出所有 store（使用方必须从此处导入；新增/移动/删除需同步维护）。
- Zustand 负责界面状态和内存缓存；需要跨启动保存的数据由 Rust 统一写入 `data/data.db`。
- 新实现不使用 localStorage、sessionStorage 或 IndexedDB 保存持久化业务数据及偏好，不读取旧客户端存储。
- 加载状态、弹窗、搜索任务上下文及临时缓存留在内存，不持久化到数据库。
- 偏好异步加载应有明确的初始化状态，避免默认值覆盖数据库中的已保存值。

### utils

- 工具函数文件必须使用英文小写命名；多单词使用 kebab-case，例如 `foo.ts`、`foo-bar.ts`。
- `utils/index.ts` 统一导出所有工具函数（使用方必须从此处导入；新增/移动/删除需同步维护）。

### shadcn

- 在项目根目录使用 `pnpm exec shadcn add <component>` 添加或更新组件；当前生成目录为 `src/ui`。
- 根目录下 `components.json` 约定的 shadcn 生成文件默认不得直接修改，应当按依赖代码使用，避免后续升级与维护成本。
- 修改 `components.json` 前，必须先确认不会影响后续生成路径或现有 import。
- `ui` 下的生成组件应遵循 `components.json` 的别名配置；其中 `@/utils/cn` 是 shadcn 对工具函数文件的固定引用，无需改为 `utils/index.ts` 聚合入口。
- 若生成组件不满足业务需求，应当优先在业务组件目录中复制或二次封装实现（如 `components/button/index.tsx`）。
- 仅在确有必要时修改原始生成文件内容时；修改后必须记录到 `docs/shadcn-patches.md`，便于后续迁移。

### 检查

- 前端修改执行 TypeScript、ESLint 基础检查；不默认执行打包、视觉回归或长时间播放测试。
- 实际播放与跨平台表现需由开发者在目标设备验收，不能以类型检查通过代替运行验证。
