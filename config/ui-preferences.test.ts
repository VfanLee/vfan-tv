import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setImmediate } from 'node:timers/promises'
import { test } from 'node:test'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'
import ts from 'typescript'
import { create } from 'zustand'

interface StoredPreference {
  scope: string
  key: string
  value: unknown
}

interface PreferenceFixture {
  initialize: () => Promise<void>
  store: {
    getState: () => { mode: string; setMode: (mode: string) => void }
    subscribe: (listener: (state: { mode: string }) => void) => () => void
  }
  rows: StoredPreference[]
  snapshots: number
  errors: string[]
  failWrite: boolean
  blockRead?: () => Promise<void>
  emit: (payload: unknown) => void
}

/** 加载真实偏好 store 和通信模块，用内存替身隔离 Tauri 与界面 */
async function fixture(): Promise<PreferenceFixture> {
  let onEvent: ((event: { payload: unknown }) => void) | undefined
  const runtime: PreferenceFixture = {
    initialize: async () => {},
    store: { getState: () => ({ mode: '', setMode: () => {} }), subscribe: () => () => {} },
    rows: [],
    snapshots: 0,
    errors: [],
    failWrite: false,
    emit: (payload) => onEvent?.({ payload }),
  }
  const context = createContext({ console, window: { addEventListener: () => {} } })
  /** 创建仅替换运行时依赖的模块 */
  const stub = (exports: Record<string, unknown>): SyntheticModule =>
    new SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
      },
      { context },
    )
  const dependencies = new Map<string, SyntheticModule | SourceTextModule>([
    ['zustand', stub({ create })],
    ['sonner', stub({ toast: { error: (message: string) => runtime.errors.push(message) } })],
    [
      '@tauri-apps/api/core',
      stub({
        isTauri: () => true,
        invoke: async (command: string, input: StoredPreference) => {
          if (command === 'get_ui_preferences_snapshot') {
            runtime.snapshots += 1
            const snapshot = structuredClone(runtime.rows)
            await runtime.blockRead?.()
            return snapshot
          }
          assert.equal(command, 'set_ui_preference')
          if (runtime.failWrite) throw new Error('write failed')
          runtime.rows = runtime.rows.filter((row) => row.scope !== input.scope || row.key !== input.key)
          runtime.rows.push(input)
          runtime.emit({ scope: input.scope, origin: 'main' })
          return undefined
        },
      }),
    ],
    [
      '@tauri-apps/api/event',
      stub({
        listen: async (_name: string, callback: typeof onEvent) => {
          onEvent = callback
          return () => {
            onEvent = undefined
          }
        },
      }),
    ],
    ['@tauri-apps/api/webviewWindow', stub({ getCurrentWebviewWindow: () => ({ label: 'main' }) })],
  ])
  /** 转译项目 TypeScript，保持实际保存、事件过滤和快照合并逻辑 */
  const load = async (path: string): Promise<SourceTextModule> => {
    const source = await readFile(new URL(path, import.meta.url), 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    return new SourceTextModule(outputText, { context })
  }
  dependencies.set('@/platform/tauri', await load('../src/platform/tauri.ts'))
  const store = await load('../src/stores/ui-preferences.ts')
  await store.link((name) => {
    const dependency = dependencies.get(name)
    assert.ok(dependency, `Unexpected dependency: ${name}`)
    return dependency
  })
  await store.evaluate()
  const exports = store.namespace as {
    initializeUiPreferences: PreferenceFixture['initialize']
    useUiPreferencesStore: PreferenceFixture['store']
  }
  runtime.initialize = exports.initializeUiPreferences
  runtime.store = exports.useUiPreferencesStore
  return runtime
}

/** 等待保存队列及其微任务完成，不启动计时器或窗口 */
async function settle(): Promise<void> {
  await setImmediate()
  await setImmediate()
}

test('保存只读取一次快照，失败保留原值且后续仍可保存', async () => {
  const app = await fixture()
  await app.initialize()
  app.store.getState().setMode('dark')
  await settle()
  assert.equal(app.snapshots, 2)
  assert.equal(app.store.getState().mode, 'dark')
  app.failWrite = true
  app.store.getState().setMode('light')
  await settle()
  assert.equal(app.store.getState().mode, 'dark')
  assert.equal(app.errors.length, 1)
  app.failWrite = false
  app.store.getState().setMode('light')
  await settle()
  assert.equal(app.store.getState().mode, 'light')
  assert.equal(app.snapshots, 3)
})

test('合并外部通知并重新读取进行中发生的变更，清空后恢复默认值', async () => {
  const app = await fixture()
  await app.initialize()
  let release: (() => void) | undefined
  app.blockRead = () =>
    new Promise<void>((resolve) => {
      release = resolve
    })
  app.rows = [{ scope: 'appearance', key: 'theme', value: 'dark' }]
  app.emit({ scope: 'appearance', origin: 'mini' })
  app.rows = [{ scope: 'appearance', key: 'theme', value: 'light' }]
  for (let index = 0; index < 10; index += 1) app.emit({ scope: 'appearance', origin: 'mini' })
  app.blockRead = undefined
  release?.()
  await settle()
  assert.equal(app.snapshots, 3)
  assert.equal(app.store.getState().mode, 'light')
  app.emit({ scope: 'radio', origin: 'mini' })
  await settle()
  assert.equal(app.snapshots, 3)
  app.rows = []
  app.emit('app-data')
  await settle()
  assert.equal(app.store.getState().mode, 'system')
  assert.equal(app.errors.length, 0)
})

test('快照发布后紧接着到达的通知不会遗漏', async () => {
  const app = await fixture()
  await app.initialize()
  const unsubscribe = app.store.subscribe((state) => {
    if (state.mode === 'dark') {
      queueMicrotask(() => {
        app.rows = [{ scope: 'appearance', key: 'theme', value: 'light' }]
        app.emit({ scope: 'appearance', origin: 'mini' })
      })
    }
  })
  app.rows = [{ scope: 'appearance', key: 'theme', value: 'dark' }]
  app.emit({ scope: 'appearance', origin: 'mini' })
  await settle()
  assert.equal(app.store.getState().mode, 'light')
  unsubscribe()
})
