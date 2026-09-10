import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setImmediate } from 'node:timers/promises'
import { test } from 'node:test'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'
import ts from 'typescript'

interface Registration {
  name: string
  emit: (payload: unknown) => void
  complete: () => void
  fail: () => void
  releases: number
}

/** 加载真实通信模块，用可控的异步注册模拟 Tauri 事件生命周期 */
async function fixture(): Promise<{
  subscribe: (name: string, listener: (payload: unknown) => void) => () => void
  registrations: Registration[]
  errors: unknown[][]
}> {
  const registrations: Registration[] = []
  const errors: unknown[][] = []
  const context = createContext({ console: { error: (...args: unknown[]) => errors.push(args) } })
  const dependencies: Record<string, Record<string, unknown>> = {
    '@tauri-apps/api/core': { invoke: () => {}, isTauri: () => true },
    '@tauri-apps/api/webviewWindow': { getCurrentWebviewWindow: () => ({ label: 'main' }) },
    '@tauri-apps/api/event': {
      listen: (name: string, callback: (event: { payload: unknown }) => void) =>
        new Promise<() => void>((resolve, reject) => {
          const registration: Registration = {
            name,
            emit: (payload) => callback({ payload }),
            complete: () =>
              resolve(() => {
                registration.releases += 1
              }),
            fail: () => reject(new Error('registration failed')),
            releases: 0,
          }
          registrations.push(registration)
        }),
    },
  }
  const source = await readFile(new URL('../src/platform/tauri.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  const module = new SourceTextModule(outputText, { context })
  await module.link((name) => {
    const exports = dependencies[name]
    assert.ok(exports, `Unexpected dependency: ${name}`)
    return new SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
      },
      { context },
    )
  })
  await module.evaluate()
  const exports = module.namespace as {
    subscribeDesktopEvent: (name: string, listener: (payload: unknown) => void) => () => void
  }
  return { subscribe: exports.subscribeDesktopEvent, registrations, errors }
}

test('同名事件复用底层注册，最后一个订阅者退出后仅释放一次', async () => {
  const app = await fixture()
  const received: unknown[] = []
  const first = app.subscribe('app-data-changed', (payload) => received.push(payload))
  const second = app.subscribe('app-data-changed', (payload) => received.push(payload))
  assert.equal(app.registrations.length, 1)
  const registration = app.registrations[0]
  registration.complete()
  await setImmediate()
  registration.emit('app-data')
  assert.deepEqual(received, ['app-data', 'app-data'])
  first()
  first()
  assert.equal(registration.releases, 0)
  registration.emit('sources')
  assert.deepEqual(received, ['app-data', 'app-data', 'sources'])
  second()
  second()
  registration.emit('ignored')
  assert.equal(received.length, 3)
  assert.equal(registration.releases, 1)
})

test('注册完成前卸载再挂载，旧清理不会影响新订阅', async () => {
  const app = await fixture()
  const received: unknown[] = []
  const first = app.subscribe('app-data-changed', () => assert.fail('已卸载的订阅收到事件'))
  first()
  const second = app.subscribe('app-data-changed', (payload) => received.push(payload))
  assert.equal(app.registrations.length, 2)
  app.registrations[0].complete()
  app.registrations[1].complete()
  await setImmediate()
  app.registrations[0].emit('old')
  app.registrations[1].emit('new')
  assert.deepEqual(received, ['new'])
  assert.equal(app.registrations[0].releases, 1)
  assert.equal(app.registrations[1].releases, 0)
  second()
  assert.equal(app.registrations[1].releases, 1)
})

test('订阅失败后可重新注册，单个回调异常不会阻断其他订阅者', async () => {
  const app = await fixture()
  const failed = app.subscribe('app-data-changed', () => {})
  app.registrations[0].fail()
  await setImmediate()
  const throwing = app.subscribe('app-data-changed', () => {
    throw new Error('callback failed')
  })
  const received: unknown[] = []
  const healthy = app.subscribe('app-data-changed', (payload) => received.push(payload))
  app.registrations[1].complete()
  await setImmediate()
  failed()
  app.registrations[1].emit('app-data')
  assert.deepEqual(received, ['app-data'])
  assert.equal(app.errors.length, 2)
  throwing()
  healthy()
  assert.equal(app.registrations[1].releases, 1)
})
