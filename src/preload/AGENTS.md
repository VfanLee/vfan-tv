# AGENTS.md

## 项目概览

`preload` 是 Vfan TV 的 Electron 预加载模块，是 main 与 renderer 之间的安全边界。它通过 `contextBridge` 向 renderer 暴露经过约束的 IPC 能力，并维护对应的前端可见类型。

## 项目结构

```text
preload
├── api             # 按领域创建的受限 preload API 工厂
├── index.ts        # 聚合 API 并通过 contextBridge 暴露
└── index.d.ts      # renderer 可见的 preload 类型声明
```

## 项目约定

### index.ts

- `index.ts` 必须只负责聚合 `api/` 中的领域 API，并通过 `contextBridge` 一次暴露 `window.api`。
- preload 是 main 与 renderer 的安全边界，应当只暴露明确需要的能力。
- 新增 API 时应在 `api/` 中按现有业务领域扩展，不将所有 `ipcRenderer.invoke` 调用重新堆回入口文件。

### index.d.ts

- `index.d.ts` 应当维护 renderer 可见的 preload 运行时 API 类型。
- 新增或调整暴露 API 时，必须同步更新 `index.ts` 与 `index.d.ts`。

### API 协同

- 修改 preload API 后，必须同步检查 renderer 的 `services/api` 调用封装是否需要更新。
- 暴露给 renderer 的数据类型应当优先复用 `src/shared`。
- 所有 IPC channel 必须引用 `@shared/ipc` 的 `IPC_CHANNELS`，不得在 preload 中手写 channel 字符串。

### 跨域边界

- preload 层不得承载 renderer 业务逻辑，只提供安全、稳定的能力桥接。
- 不得将完整 `ipcRenderer` 或任意 channel 调用能力暴露给 renderer；事件订阅必须返回对应的取消订阅函数。
- 修改 `src/shared` 后必须执行 `pnpm typecheck`。
