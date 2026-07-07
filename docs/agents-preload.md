# Preload agent guide

## 范围

适用于 `src/preload` 下的 Electron preload 代码和暴露给 renderer 的运行时 API 类型。

## 目录

```text
src/preload
├── index.ts        # contextBridge 暴露实现
└── index.d.ts      # renderer 可见的 preload 类型声明
```

## 约定

- preload 是 main 与 renderer 的安全边界，只暴露明确需要的能力。
- 新增或调整暴露 API 时，同步更新 `index.ts` 与 `index.d.ts`。
- 暴露给 renderer 的数据类型优先复用 `src/shared`。
- 修改 preload API 后，检查 renderer 的 `services/api` 调用封装是否需要同步。
- 修改 `src/shared` 后必须执行 `pnpm typecheck`。
