import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setImmediate } from 'node:timers/promises'
import { test } from 'node:test'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'
import { create } from 'zustand'
import { uniqBy } from 'es-toolkit/array'
import ts from 'typescript'
import type { VodSourceConfig } from '../src/types/source'
import type { HotRecommendationsPage } from '../src/types/home'
import type { VodCatalogPage, VodCatalogRequest } from '../src/types/vod'

interface CacheEntry {
  result: VodCatalogPage
  fetchedAt: number
}
interface Cache {
  fetchVodCatalogPage: (source: VodSourceConfig, input: VodCatalogRequest) => Promise<CacheEntry>
  getVodCatalogSourceKey: (source: VodSourceConfig) => string
  getVodCatalogContextKey: (source: VodSourceConfig, category?: string, keyword?: string) => string
  readVodCatalogPage: (key: string, page: number) => CacheEntry | undefined
  isRecommendationCacheExpired: (fetchedAt: number) => boolean
  clearVodCatalogPages: () => void
  pruneVodCatalogPages: (sources: VodSourceConfig[]) => void
}
interface HotState {
  items: HotRecommendationsPage['items']
  fetchedAt: number | null
  nextStart: number
  initialized: boolean
  isRefreshing: boolean
  errorMessage: string
}
interface StoreState {
  hot: Record<string, HotState>
  visitHotCategory: (category: string, type: string) => Promise<void>
  loadHotPage: (category: string, type: string) => Promise<void>
  retryHotCategory: (category: string, type: string) => Promise<void>
  clearRecommendationCache: () => void
}
interface Store {
  getState: () => StoreState
}
interface Options {
  source?: VodSourceConfig
  page: number
  categoryId?: string
  keyword?: string
}
interface View {
  items: VodCatalogPage['items']
  page: number
  pageCount: number
  redirectPage: number | null
  isLoading: boolean
  isRefreshing: boolean
  errorMessage: string
  retry: () => Promise<void>
}
interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}
interface Harness {
  react: Record<string, (...args: never[]) => unknown>
  read: () => View
  readonly updates: number
  rerender: () => void
  unmount: () => void
  flush: () => Promise<void>
}
interface Fixture {
  cache: Cache
  store: Store
  vodRequests: Array<Deferred<VodCatalogPage> & { input: VodCatalogRequest }>
  hotRequests: Array<Deferred<HotRecommendationsPage> & { input: { start: number; category: string; type: string } }>
  advance: (ms: number) => void
  mount: (options: Options) => Harness & { setOptions: (options: Options) => void }
}

/** 创建可以指定返回顺序的请求 */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

/** 构造带完整缓存身份的点播源 */
function source(id = 'a'): VodSourceConfig {
  return {
    id,
    name: id,
    url: `https://example.test/${id}`,
    headers: {},
    disabled: false,
    backups: [],
    sort: 0,
    createdAt: 0,
    updatedAt: 0,
  }
}

/** 构造不同分页内容及有效空页 */
function vodPage(page = 1, ids: string[] = [`p${page}`]): VodCatalogPage {
  return {
    categories: [{ id: '1', name: '电影', parentId: '0' }],
    items: ids.map((id) => ({ sourceId: 'a', sourceName: 'a', vodId: id, title: id, raw: {} })),
    page,
    pageCount: 5,
    pageSize: 1,
    total: 5,
  }
}

/** 构造豆瓣分页和继续加载游标 */
function hotPage(ids = ['first'], nextStart = 24, hasMore = true): HotRecommendationsPage {
  return {
    items: ids.map((id) => ({ id, title: id, category: 'movie', raw: {} })),
    start: Math.max(0, nextStart - 24),
    limit: 24,
    nextStart,
    hasMore,
  }
}

/** 调度真实目录 hook 的状态和 effect，用于验证重挂载与迟到请求 */
function hookHarness(render: () => View): Harness {
  const slots: unknown[] = []
  const effects = new Map<number, { deps: unknown[]; cleanup?: () => void }>()
  const jobs: Array<() => void> = []
  let cursor = 0
  let dirty = true
  let mounted = true
  let updates = 0
  let view!: View
  /** 比较渲染依赖 */
  const same = (a: unknown[], b: unknown[]): boolean =>
    a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const react = {
    /** 保存状态并标记下一次渲染 */
    useState<T>(initial: T | (() => T)): [T, (next: T | ((value: T) => T)) => void] {
      const i = cursor++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? (initial as () => T)() : initial
      return [
        slots[i] as T,
        (next: T | ((value: T) => T)) => {
          const value = typeof next === 'function' ? (next as (value: T) => T)(slots[i] as T) : next
          if (Object.is(slots[i], value)) return
          slots[i] = value
          dirty = true
          updates += 1
        },
      ]
    },
    /** 保存跨渲染引用 */
    useRef<T>(initial: T): { current: T } {
      const i = cursor++
      if (!(i in slots)) slots[i] = { current: initial }
      return slots[i] as { current: T }
    },
    /** 按依赖复用派生值 */
    useMemo<T>(factory: () => T, deps: unknown[]): T {
      const i = cursor++
      const previous = slots[i] as { value: T; deps: unknown[] } | undefined
      if (!previous || !same(previous.deps, deps)) slots[i] = { value: factory(), deps }
      return (slots[i] as { value: T }).value
    },
    /** 按依赖复用回调 */
    useCallback<T>(callback: T, deps: unknown[]): T {
      return react.useMemo(() => callback, deps)
    },
    /** 提交后执行副作用并释放旧订阅 */
    useEffect(effect: () => void | (() => void), deps: unknown[]): void {
      const i = cursor++
      const previous = effects.get(i)
      if (previous && same(previous.deps, deps)) return
      jobs.push(() => {
        previous?.cleanup?.()
        effects.set(i, { deps, cleanup: effect() || undefined })
      })
    },
  }
  return {
    react,
    read: () => view,
    get updates() {
      return updates
    },
    rerender: () => {
      dirty = true
    },
    unmount: () => {
      mounted = false
      for (const effect of effects.values()) effect.cleanup?.()
    },
    flush: async () => {
      for (let i = 0; i < 30; i += 1) {
        await setImmediate()
        if (!dirty || !mounted) return
        dirty = false
        cursor = 0
        view = render()
        for (const job of jobs.splice(0)) job()
      }
      assert.fail('Hook did not settle')
    },
  }
}

/** 在独立窗口环境执行真实缓存、store 和 hook，替换网络与时钟 */
async function fixture(): Promise<Fixture> {
  let now = 0
  let activeHarness: ReturnType<typeof hookHarness>
  const vodRequests: Array<ReturnType<typeof deferred<VodCatalogPage>> & { input: VodCatalogRequest }> = []
  const hotRequests: Array<
    ReturnType<typeof deferred<HotRecommendationsPage>> & { input: { start: number; category: string; type: string } }
  > = []
  const context = createContext({
    console,
    Error,
    structuredClone,
    Date: class extends Date {
      /** 返回受控时钟 */
      static now(): number {
        return now
      }
    },
  })
  /** 包装替换依赖 */
  const stub = (values: Record<string, unknown>): SyntheticModule =>
    new SyntheticModule(
      Object.keys(values),
      function () {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value)
      },
      { context },
    )
  const modules = new Map<string, SourceTextModule | SyntheticModule>([
    ['zustand', stub({ create })],
    ['es-toolkit/array', stub({ uniqBy })],
    [
      '@/constants',
      stub({
        categorySections: [{ key: 'movie', defaultType: '全部', filters: [{ value: '全部' }, { value: '华语' }] }],
      }),
    ],
    ['@/utils', stub({ getHotCacheKey: (category: string, type: string) => `${category}:${type}` })],
    [
      'react',
      stub(
        Object.fromEntries(
          ['useState', 'useRef', 'useMemo', 'useCallback', 'useEffect'].map((key) => [
            key,
            (...args: unknown[]) => {
              const fn = activeHarness.react[key as keyof typeof activeHarness.react] as (
                ...input: unknown[]
              ) => unknown
              return fn(...args)
            },
          ]),
        ),
      ),
    ],
    [
      '@/platform/api',
      stub({
        getVodCatalogPage: (input: VodCatalogRequest) => {
          const request = { ...deferred<VodCatalogPage>(), input }
          vodRequests.push(request)
          return request.promise
        },
        getHotRecommendationsPage: (input: { start: number; category: string; type: string }) => {
          const request = { ...deferred<HotRecommendationsPage>(), input }
          hotRequests.push(request)
          return request.promise
        },
        getHomeData: async () => ({ recentPlays: [], recommendations: [] }),
        listSources: async () => [source()],
        onAppDataChange: () => () => {},
        switchSourceBackup: async () => source(),
      }),
    ],
  ])
  /** 转译实际源文件，保留所有业务实现 */
  const load = async (name: string, path: string): Promise<object> => {
    const sourceText = await readFile(new URL(path, import.meta.url), 'utf8')
    const { outputText } = ts.transpileModule(sourceText, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    const module = new SourceTextModule(outputText, { context })
    modules.set(name, module)
    await module.link((key) => {
      const dependency = modules.get(key)
      assert.ok(dependency, key)
      return dependency
    })
    await module.evaluate()
    return module.namespace
  }
  const cache = (await load(
    '@/platform/cache/recommendation-cache',
    '../src/platform/cache/recommendation-cache.ts',
  )) as Cache
  await load('@/platform/cache/vod-catalog-categories', '../src/platform/cache/vod-catalog-categories.ts')
  const { useAppDataStore: store } = (await load('store', '../src/stores/app-data.ts')) as { useAppDataStore: Store }
  const { useVodCatalog: hook } = (await load('hook', '../src/pages/catalog-home-page/hooks/use-vod-catalog.ts')) as {
    useVodCatalog: (options: Options) => View
  }
  return {
    cache,
    store,
    vodRequests,
    hotRequests,
    advance: (ms: number) => {
      now += ms
    },
    mount: (initial: Options) => {
      let options = initial
      const harness = hookHarness(() => {
        activeHarness = harness
        return hook(options)
      })
      return {
        ...harness,
        setOptions: (next: Options) => {
          options = next
          harness.rerender()
        },
      }
    },
  }
}

test('点播缓存从成功起计时，访问不续期，同页并发合并且空结果可缓存', async () => {
  const f = await fixture()
  const input = { sourceId: 'a', page: 1 }
  const first = f.cache.fetchVodCatalogPage(source(), input)
  assert.equal(f.cache.fetchVodCatalogPage(source(), input), first)
  await setImmediate()
  f.advance(2000)
  f.vodRequests[0].resolve(vodPage(1, []))
  await first
  const key = f.cache.getVodCatalogContextKey(source())
  f.advance(599999)
  const entry = f.cache.readVodCatalogPage(key, 1)!
  assert.equal(f.cache.isRecommendationCacheExpired(entry.fetchedAt), false)
  assert.equal(entry.result.items.length, 0)
  f.advance(1)
  assert.equal(f.cache.isRecommendationCacheExpired(f.cache.readVodCatalogPage(key, 1)!.fetchedAt), true)
  assert.equal((await fixture()).cache.readVodCatalogPage(key, 1), undefined)
})

test('点播按源配置和查询隔离，头字段排序不改变身份，缓存限制为最近一百页', async () => {
  const f = await fixture()
  const a = { ...source(), headers: { Z: 'z', A: 'a' } }
  assert.equal(f.cache.getVodCatalogSourceKey(a), f.cache.getVodCatalogSourceKey({ ...a, headers: { A: 'a', Z: 'z' } }))
  for (const change of [{ id: 'b' }, { name: 'b' }, { url: 'https://new.test' }, { headers: { A: 'b' } }]) {
    assert.notEqual(f.cache.getVodCatalogSourceKey(a), f.cache.getVodCatalogSourceKey({ ...a, ...change }))
  }
  assert.notEqual(f.cache.getVodCatalogContextKey(a, '1', 'x'), f.cache.getVodCatalogContextKey(a, '2', 'x'))
  assert.notEqual(f.cache.getVodCatalogContextKey(a, '1', 'x'), f.cache.getVodCatalogContextKey(a, '1', 'y'))
  for (let page = 1; page <= 100; page += 1) {
    const task = f.cache.fetchVodCatalogPage(a, { sourceId: 'a', page })
    await setImmediate()
    f.vodRequests.at(-1)!.resolve(vodPage(page))
    await task
  }
  const key = f.cache.getVodCatalogContextKey(a)
  f.cache.readVodCatalogPage(key, 1)
  const task = f.cache.fetchVodCatalogPage(a, { sourceId: 'a', page: 101 })
  await setImmediate()
  f.vodRequests.at(-1)!.resolve(vodPage(101))
  await task
  assert.ok(f.cache.readVodCatalogPage(key, 1))
  assert.equal(f.cache.readVodCatalogPage(key, 2), undefined)
})

test('清理或修改源后旧请求不能填回缓存，也不能移除替代请求', async () => {
  const f = await fixture()
  const input = { sourceId: 'a', page: 1 }
  const old = f.cache.fetchVodCatalogPage(source(), input)
  const rejected = assert.rejects(old, /失效/)
  await setImmediate()
  f.cache.clearVodCatalogPages()
  const replacement = f.cache.fetchVodCatalogPage(source(), input)
  await setImmediate()
  f.vodRequests[0].resolve(vodPage())
  await rejected
  assert.equal(f.cache.fetchVodCatalogPage(source(), input), replacement)
  f.vodRequests[1].resolve(vodPage(1, ['new']))
  await replacement
  f.cache.pruneVodCatalogPages([{ ...source(), disabled: true }])
  assert.equal(f.cache.readVodCatalogPage(f.cache.getVodCatalogContextKey(source()), 1), undefined)
})

test('热门访问复用多页缓存，到期更新第一页并重置游标，追加不续期', async () => {
  const f = await fixture()
  const first = f.store.getState().visitHotCategory('movie', '全部')
  await setImmediate()
  f.hotRequests[0].resolve(hotPage())
  await first
  f.advance(300000)
  const more = f.store.getState().loadHotPage('movie', '全部')
  await setImmediate()
  f.hotRequests[1].resolve(hotPage(['second'], 48))
  await more
  await f.store.getState().visitHotCategory('movie', '全部')
  assert.equal(f.hotRequests.length, 2)
  assert.equal(f.store.getState().hot['movie:全部'].items.length, 2)
  assert.equal(f.store.getState().hot['movie:全部'].fetchedAt, 0)
  f.advance(300000)
  const refresh = f.store.getState().visitHotCategory('movie', '全部')
  const duplicate = f.store.getState().visitHotCategory('movie', '全部')
  const blockedMore = f.store.getState().loadHotPage('movie', '全部')
  await setImmediate()
  assert.equal(f.hotRequests.length, 3)
  assert.equal(f.hotRequests[2].input.start, 0)
  assert.equal(f.store.getState().hot['movie:全部'].isRefreshing, true)
  assert.equal(f.store.getState().hot['movie:全部'].items.length, 2)
  f.hotRequests[2].resolve(hotPage(['new'], 24))
  await Promise.all([refresh, duplicate, blockedMore])
  assert.equal(f.store.getState().hot['movie:全部'].items[0].id, 'new')
  assert.equal(f.store.getState().hot['movie:全部'].items.length, 1)
  assert.equal(f.store.getState().hot['movie:全部'].nextStart, 24)
})

test('热门过期更新失败保留列表，重试首批；追加失败重试原游标', async () => {
  const f = await fixture()
  const first = f.store.getState().visitHotCategory('movie', '全部')
  await setImmediate()
  f.hotRequests[0].resolve(hotPage())
  await first
  f.advance(600000)
  const refresh = f.store.getState().visitHotCategory('movie', '全部')
  await setImmediate()
  f.hotRequests[1].reject(new Error('更新失败'))
  await refresh
  assert.equal(f.store.getState().hot['movie:全部'].items.length, 1)
  assert.equal(f.store.getState().hot['movie:全部'].fetchedAt, 0)
  const retry = f.store.getState().retryHotCategory('movie', '全部')
  await setImmediate()
  assert.equal(f.hotRequests[2].input.start, 0)
  f.hotRequests[2].resolve(hotPage(['new']))
  await retry
  const more = f.store.getState().loadHotPage('movie', '全部')
  await setImmediate()
  f.hotRequests[3].reject(new Error('分页失败'))
  await more
  const retryMore = f.store.getState().retryHotCategory('movie', '全部')
  await setImmediate()
  assert.equal(f.hotRequests[4].input.start, 24)
  f.hotRequests[4].resolve(hotPage(['last'], 48, false))
  await retryMore
  assert.equal(f.store.getState().hot['movie:全部'].items.length, 2)
})

test('热门清理后旧分类结果不能回填，新分类独立且成功空结果不重复请求', async () => {
  const f = await fixture()
  const old = f.store.getState().visitHotCategory('movie', '全部')
  await setImmediate()
  f.store.getState().clearRecommendationCache()
  const next = f.store.getState().visitHotCategory('movie', '华语')
  await setImmediate()
  f.hotRequests[0].resolve(hotPage(['old']))
  await old
  assert.equal(f.store.getState().hot['movie:全部'].initialized, false)
  f.hotRequests[1].resolve(hotPage([], 0, false))
  await next
  await f.store.getState().visitHotCategory('movie', '华语')
  assert.equal(f.hotRequests.length, 2)
  assert.equal(f.store.getState().hot['movie:华语'].initialized, true)
})

test('点播返回页面直接复用缓存，到期后台更新失败保留内容并可原地重试', async (t) => {
  const f = await fixture()
  const options = { source: source(), page: 1 }
  const first = f.mount(options)
  await first.flush()
  f.vodRequests[0].resolve(vodPage())
  await first.flush()
  first.unmount()
  const cached = f.mount(options)
  await cached.flush()
  assert.equal(f.vodRequests.length, 1)
  assert.equal(cached.read().items[0].title, 'p1')
  cached.unmount()
  f.advance(600000)
  const expired = f.mount(options)
  t.after(expired.unmount)
  await expired.flush()
  assert.equal(expired.read().isLoading, false)
  assert.equal(expired.read().isRefreshing, true)
  f.vodRequests[1].reject(new Error('更新失败'))
  await expired.flush()
  assert.equal(expired.read().items[0].title, 'p1')
  assert.equal(expired.read().errorMessage, '更新失败')
  expired.rerender()
  await expired.flush()
  assert.equal(f.vodRequests.length, 2)
  const retry = expired.read().retry()
  await expired.flush()
  f.vodRequests[2].resolve(vodPage(1, ['new']))
  await retry
  await expired.flush()
  assert.equal(expired.read().items[0].title, 'new')
  assert.equal(expired.read().isRefreshing, false)
})

test('点播切页迟到结果不覆盖当前页，清理和卸载使旧回调失效', async (t) => {
  const f = await fixture()
  const h = f.mount({ source: source(), page: 1 })
  t.after(h.unmount)
  await h.flush()
  h.setOptions({ source: source(), page: 2 })
  await h.flush()
  f.vodRequests[1].resolve(vodPage(2))
  await h.flush()
  f.vodRequests[0].resolve(vodPage())
  await h.flush()
  assert.equal(h.read().page, 2)
  f.advance(600000)
  const retry = h.read().retry()
  await h.flush()
  f.cache.clearVodCatalogPages()
  await h.flush()
  f.vodRequests[2].resolve(vodPage(2, ['old']))
  await retry
  await h.flush()
  assert.equal(h.read().isLoading, true)
  f.vodRequests[3].resolve(vodPage(2, ['new']))
  await h.flush()
  assert.equal(h.read().items[0].title, 'new')
  const last = h.read().retry()
  await h.flush()
  h.unmount()
  const title = h.read().items[0].title
  f.vodRequests[4].resolve(vodPage(2, ['unmounted']))
  await last
  await h.flush()
  assert.equal(h.read().items[0].title, title)
})

test('点播缓存命中仍校正重复页和空页，过期更新后解除旧分页上限', async (t) => {
  const f = await fixture()
  const h = f.mount({ source: source(), page: 1 })
  t.after(h.unmount)
  await h.flush()
  f.vodRequests[0].resolve(vodPage())
  await h.flush()
  h.setOptions({ source: source(), page: 2 })
  await h.flush()
  f.vodRequests[1].resolve(vodPage(2, ['p1']))
  await h.flush()
  assert.equal(h.read().redirectPage, 1)
  assert.equal(h.read().pageCount, 1)
  const remount = f.mount({ source: source(), page: 2 })
  t.after(remount.unmount)
  await remount.flush()
  assert.equal(f.vodRequests.length, 2)
  assert.equal(remount.read().redirectPage, 1)
  h.setOptions({ source: source(), page: 1 })
  await h.flush()
  f.advance(600000)
  const retry = h.read().retry()
  await h.flush()
  f.vodRequests[2].resolve(vodPage(1, ['changed']))
  await retry
  await h.flush()
  assert.equal(h.read().pageCount, 5)
  h.setOptions({ source: source(), page: 3 })
  await h.flush()
  f.vodRequests[3].resolve(vodPage(3, []))
  await h.flush()
  assert.equal(h.read().redirectPage, 1)
})

test('热门过期访问遇到旧分页进行中，等待结束后从首批刷新', async () => {
  const f = await fixture()
  const first = f.store.getState().visitHotCategory('movie', '全部')
  await setImmediate()
  f.hotRequests[0].resolve(hotPage())
  await first
  const more = f.store.getState().loadHotPage('movie', '全部')
  await setImmediate()
  f.advance(600000)
  const visit = f.store.getState().visitHotCategory('movie', '全部')
  assert.equal(f.hotRequests.length, 2)
  f.hotRequests[1].resolve(hotPage(['old-more'], 48))
  await more
  await setImmediate()
  assert.equal(f.hotRequests[2].input.start, 0)
  f.hotRequests[2].resolve(hotPage(['fresh']))
  await visit
  assert.equal(f.store.getState().hot['movie:全部'].items.length, 1)
  assert.equal(f.store.getState().hot['movie:全部'].items[0].id, 'fresh')
})

test('点播相同配置对象重建不会重新请求，换源后迟到结果只缓存原上下文', async (t) => {
  const f = await fixture()
  const h = f.mount({ source: source(), page: 1 })
  t.after(h.unmount)
  await h.flush()
  h.setOptions({ source: { ...source() }, page: 1 })
  await h.flush()
  assert.equal(f.vodRequests.length, 1)
  h.setOptions({ source: source('b'), page: 1 })
  await h.flush()
  f.vodRequests[1].resolve(vodPage(1, ['b']))
  await h.flush()
  f.vodRequests[0].resolve(vodPage(1, ['a']))
  await h.flush()
  assert.equal(h.read().items[0].title, 'b')
  h.setOptions({ source: source(), page: 1 })
  await h.flush()
  assert.equal(h.read().items[0].title, 'a')
  assert.equal(f.vodRequests.length, 2)
})

test('点播配置失效移除进行中请求，旧结果不会进入新源缓存', async () => {
  const f = await fixture()
  const old = f.cache.fetchVodCatalogPage(source(), { sourceId: 'a', page: 1 })
  const rejection = assert.rejects(old, /失效/)
  await setImmediate()
  const updated = { ...source(), headers: { Authorization: 'new' } }
  f.cache.pruneVodCatalogPages([updated])
  f.vodRequests[0].resolve(vodPage())
  await rejection
  assert.equal(f.cache.readVodCatalogPage(f.cache.getVodCatalogContextKey(source()), 1), undefined)
  assert.equal(f.cache.readVodCatalogPage(f.cache.getVodCatalogContextKey(updated), 1), undefined)
})
