import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setImmediate } from 'node:timers/promises'
import { test } from 'node:test'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'
import ts from 'typescript'
import type { IptvPlaylist, IptvSourceConfig } from '../src/types/iptv'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

interface CatalogView {
  sources: IptvSourceConfig[]
  sourceId: string
  selectSource: (id: string) => void
  isLoadingSources: boolean
  sourcesError?: string
  retrySources: () => void
  playlist?: IptvPlaylist
  isLoadingCatalog: boolean
  catalogRefreshStatus: string
  catalogError?: string
  refreshCatalog: () => Promise<unknown>
}

/** 创建可控制完成顺序的请求 */
function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

/** 构造频道加载所需的源配置 */
function source(id: string): IptvSourceConfig {
  return {
    id,
    name: id,
    url: `https://example.test/${id}.m3u`,
    disabled: false,
    headers: {},
    backups: [],
    sort: 0,
    createdAt: 0,
    updatedAt: 0,
  }
}

/** 构造可辨别请求来源的频道目录 */
function playlist(sourceId: string, title = sourceId): IptvPlaylist {
  return {
    sourceId,
    sourceUrl: `https://example.test/${sourceId}.m3u`,
    fetchedAt: 1,
    channels: [{ id: title, title, group: '默认', streams: [] }],
  }
}

/** 用确定性的 hook 调度替身执行真实加载逻辑，不模拟 DOM 或网络服务 */
async function fixture(initialSourceId = 'a'): Promise<{
  read: () => CatalogView
  readonly updates: number
  sourceRequests: Deferred<IptvSourceConfig[]>[]
  catalogRequests: Array<Deferred<IptvPlaylist> & { sourceId: string; force: boolean }>
  flush: () => Promise<void>
  emitSourceChange: () => void
  unmount: () => void
}> {
  const slots: unknown[] = []
  const effectSlots = new Map<number, { dependencies: readonly unknown[]; cleanup?: () => void }>()
  const pendingEffects: Array<() => void> = []
  let cursor = 0
  let dirty = true
  let mounted = true
  let updates = 0
  let view!: CatalogView
  let listener: ((domain: string) => void) | undefined
  const sourceRequests: Deferred<IptvSourceConfig[]>[] = []
  const catalogRequests: Array<Deferred<IptvPlaylist> & { sourceId: string; force: boolean }> = []

  /** 比较 hook 的依赖是否发生变化 */
  const sameDependencies = (previous: readonly unknown[], next: readonly unknown[]): boolean =>
    previous.length === next.length && previous.every((value, index) => Object.is(value, next[index]))

  /** 保存状态并记录异步回调触发的更新 */
  function useState<T>(initial?: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] {
    const index = cursor++
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? (initial as () => T)() : initial
    return [
      slots[index] as T,
      (next) => {
        const value = typeof next === 'function' ? (next as (previous: T) => T)(slots[index] as T) : next
        if (Object.is(value, slots[index])) return
        slots[index] = value
        updates += 1
        dirty = true
      },
    ]
  }

  /** 保留跨渲染使用的请求标识与目录快照 */
  function useRef<T>(initial: T): { current: T } {
    const index = cursor++
    if (!(index in slots)) slots[index] = { current: initial }
    return slots[index] as { current: T }
  }

  /** 按依赖保存回调身份 */
  function useCallback<T>(callback: T, dependencies: readonly unknown[]): T {
    const index = cursor++
    const previous = slots[index] as { callback: T; dependencies: readonly unknown[] } | undefined
    if (!previous || !sameDependencies(previous.dependencies, dependencies)) slots[index] = { callback, dependencies }
    return (slots[index] as { callback: T }).callback
  }

  /** 在提交后执行 effect，并在依赖变化或卸载时执行清理 */
  function useEffect(effect: () => void | (() => void), dependencies: readonly unknown[]): void {
    const index = cursor++
    const previous = effectSlots.get(index)
    if (previous && sameDependencies(previous.dependencies, dependencies)) return
    pendingEffects.push(() => {
      previous?.cleanup?.()
      effectSlots.set(index, { dependencies, cleanup: effect() || undefined })
    })
  }

  const context = createContext({ Error })
  const dependencies: Record<string, Record<string, unknown>> = {
    'react': { useState, useRef, useCallback, useEffect },
    '@/platform/api': {
      listIptvSources: () => {
        const request = deferred<IptvSourceConfig[]>()
        sourceRequests.push(request)
        return request.promise
      },
      getIptvCatalog: (sourceId: string, force = false) => {
        const request = { ...deferred<IptvPlaylist>(), sourceId, force }
        catalogRequests.push(request)
        return request.promise
      },
      onAppDataChange: (callback: typeof listener) => {
        listener = callback
        return () => {
          listener = undefined
        }
      },
    },
  }
  const sourceText = await readFile(new URL('../src/pages/iptv-page/use-iptv-catalog.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(sourceText, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  const module = new SourceTextModule(outputText, { context })
  await module.link((name) => {
    const values = dependencies[name]
    assert.ok(values, `Unexpected dependency: ${name}`)
    return new SyntheticModule(
      Object.keys(values),
      function () {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value)
      },
      { context },
    )
  })
  await module.evaluate()
  const { useIptvCatalog: renderCatalog } = module.namespace as { useIptvCatalog: (initial: string) => CatalogView }

  /** 推进 Promise 回调和由状态更新引起的 effect */
  async function flush(): Promise<void> {
    for (let iteration = 0; iteration < 30; iteration += 1) {
      await setImmediate()
      if (!dirty || !mounted) return
      dirty = false
      cursor = 0
      view = renderCatalog(initialSourceId)
      for (const effect of pendingEffects.splice(0)) effect()
    }
    assert.fail('Hook did not settle')
  }

  await flush()
  return {
    read: () => view,
    get updates() {
      return updates
    },
    sourceRequests,
    catalogRequests,
    flush,
    emitSourceChange: () => listener?.('iptv-sources'),
    unmount: () => {
      mounted = false
      for (const effect of effectSlots.values()) effect.cleanup?.()
    },
  }
}

test('源列表完成不会提前结束频道加载，目录成功后才结束加载', async (t) => {
  const f = await fixture()
  t.after(f.unmount)
  assert.equal(f.read().isLoadingSources, true)
  assert.equal(f.catalogRequests.length, 0)
  f.sourceRequests[0].resolve([source('a')])
  await f.flush()
  assert.equal(f.read().isLoadingSources, false)
  assert.equal(f.read().isLoadingCatalog, true)
  assert.equal(f.read().playlist, undefined)
  f.catalogRequests[0].resolve(playlist('a'))
  await f.flush()
  assert.equal(f.read().isLoadingCatalog, false)
  assert.equal(f.read().playlist?.sourceId, 'a')
})

test('手动刷新接管未完成的初次加载，旧请求不能提前清除加载状态', async (t) => {
  const f = await fixture()
  t.after(f.unmount)
  f.sourceRequests[0].resolve([source('a')])
  await f.flush()
  const refresh = f.read().refreshCatalog()
  await f.flush()
  assert.equal(f.catalogRequests[1].force, true)
  f.catalogRequests[0].resolve(playlist('a', '旧请求'))
  await f.flush()
  assert.equal(f.read().isLoadingCatalog, true)
  assert.equal(f.read().playlist, undefined)
  f.catalogRequests[1].reject(new Error('源站超时'))
  await refresh
  await f.flush()
  assert.equal(f.read().isLoadingCatalog, false)
  assert.equal(f.read().catalogError, '源站超时')
  const retry = f.read().refreshCatalog()
  await f.flush()
  assert.equal(f.read().catalogError, undefined)
  assert.equal(f.read().isLoadingCatalog, true)
  f.catalogRequests[2].resolve(playlist('a', '重试成功'))
  await retry
  await f.flush()
  assert.equal(f.read().playlist?.channels[0].title, '重试成功')
  assert.equal(f.read().catalogRefreshStatus, 'idle')
  assert.equal(f.read().isLoadingCatalog, false)
})

test('切换源后忽略旧目录与失败，重复选择当前源不清空数据', async (t) => {
  const f = await fixture()
  t.after(f.unmount)
  f.sourceRequests[0].resolve([source('a'), source('b')])
  await f.flush()
  f.read().selectSource('b')
  await f.flush()
  f.catalogRequests[1].resolve(playlist('b'))
  await f.flush()
  f.catalogRequests[0].reject(new Error('旧源失败'))
  await f.flush()
  assert.equal(f.read().sourceId, 'b')
  assert.equal(f.read().playlist?.sourceId, 'b')
  assert.equal(f.read().catalogError, undefined)
  f.read().selectSource('b')
  await f.flush()
  assert.equal(f.read().playlist?.sourceId, 'b')
  assert.equal(f.catalogRequests.length, 2)
})

test('过期目录立即展示，后台和手动更新失败均保留频道', async (t) => {
  const f = await fixture()
  t.after(f.unmount)
  f.sourceRequests[0].resolve([source('a')])
  await f.flush()
  f.catalogRequests[0].resolve({ ...playlist('a'), cached: true, stale: true })
  await f.flush()
  assert.equal(f.read().isLoadingCatalog, false)
  assert.equal(f.read().catalogRefreshStatus, 'background')
  assert.equal(f.read().playlist?.sourceId, 'a')
  f.catalogRequests[1].reject(new Error('后台更新失败'))
  await f.flush()
  assert.equal(f.read().catalogRefreshStatus, 'failed')
  assert.equal(f.read().playlist?.sourceId, 'a')
  const refresh = f.read().refreshCatalog()
  await f.flush()
  assert.equal(f.read().isLoadingCatalog, false)
  f.catalogRequests[2].reject(new Error('手动更新失败'))
  await refresh
  await f.flush()
  assert.equal(f.read().catalogError, '手动更新失败')
  assert.equal(f.read().playlist?.sourceId, 'a')
})

test('源列表失败可原地重试，并忽略重叠请求的过时结果', async (t) => {
  const f = await fixture()
  t.after(f.unmount)
  f.sourceRequests[0].reject(new Error('源列表读取失败'))
  await f.flush()
  assert.equal(f.read().sourcesError, '源列表读取失败')
  assert.equal(f.read().isLoadingSources, false)
  f.read().retrySources()
  await f.flush()
  f.emitSourceChange()
  await f.flush()
  f.sourceRequests[1].resolve([source('过时配置')])
  await f.flush()
  assert.equal(f.read().isLoadingSources, true)
  assert.equal(f.read().sources.length, 0)
  f.sourceRequests[2].resolve([source('a')])
  await f.flush()
  assert.equal(f.read().sourcesError, undefined)
  assert.equal(f.read().sourceId, 'a')
  assert.equal(f.read().isLoadingCatalog, true)
  assert.equal(f.catalogRequests.length, 1)
})

test('源配置刷新完成不能清除新目录的加载状态', async (t) => {
  const f = await fixture()
  t.after(f.unmount)
  f.sourceRequests[0].resolve([source('a')])
  await f.flush()
  f.catalogRequests[0].resolve(playlist('a', '旧配置'))
  await f.flush()
  f.emitSourceChange()
  await f.flush()
  f.sourceRequests[1].resolve([{ ...source('a'), url: 'https://example.test/new.m3u' }])
  await f.flush()
  assert.equal(f.read().isLoadingSources, false)
  assert.equal(f.read().isLoadingCatalog, true)
  assert.equal(f.read().playlist, undefined)
  f.catalogRequests[1].resolve(playlist('a', '新配置'))
  await f.flush()
  assert.equal(f.read().isLoadingCatalog, false)
  assert.equal(f.read().playlist?.channels[0].title, '新配置')
})

test('页面卸载后手动刷新与源请求均不能回写状态或返回成功通知', async () => {
  const f = await fixture()
  f.sourceRequests[0].resolve([source('a')])
  await f.flush()
  const refresh = f.read().refreshCatalog()
  f.emitSourceChange()
  await f.flush()
  f.unmount()
  const updates = f.updates
  f.sourceRequests[1].resolve([source('b')])
  f.catalogRequests[0].resolve(playlist('a', '初次请求'))
  f.catalogRequests[1].resolve(playlist('a', '手动请求'))
  assert.equal(await refresh, undefined)
  await f.flush()
  assert.equal(f.updates, updates)
})

test('成功返回空目录与请求失败保持不同状态', async (t) => {
  const f = await fixture()
  t.after(f.unmount)
  f.sourceRequests[0].resolve([source('a')])
  await f.flush()
  f.catalogRequests[0].reject(new Error('连接失败'))
  await f.flush()
  assert.equal(f.read().isLoadingCatalog, false)
  assert.equal(f.read().catalogError, '连接失败')
  assert.equal(f.read().playlist, undefined)
  const refresh = f.read().refreshCatalog()
  f.catalogRequests[1].resolve({ ...playlist('a'), channels: [] })
  await refresh
  await f.flush()
  assert.equal(f.read().isLoadingCatalog, false)
  assert.equal(f.read().catalogError, undefined)
  assert.equal(f.read().playlist?.channels.length, 0)
})
