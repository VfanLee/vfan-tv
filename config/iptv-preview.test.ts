import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setImmediate } from 'node:timers/promises'
import { test } from 'node:test'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'
import ts from 'typescript'

interface Target {
  src: string
  type: 'native'
  release: () => void | Promise<void>
}

interface CacheApi {
  getLivePreview: (key: string, resolveTarget: () => Promise<Target>, signal: AbortSignal) => Promise<string>
  readCachedLivePreview: (key: string) => string | undefined
  clearIptvPreviewFailures: () => void
  clearIptvPreviewCache: () => void
}

/** 加载真实预览模块，仅替换媒体、DOM 与时钟等外部能力 */
async function loadModule<T>(
  file: string,
  dependencies: Record<string, Record<string, unknown>> = {},
  globals: Record<string, unknown> = {},
): Promise<T> {
  const context = createContext({ AbortController, DOMException, ...globals })
  const source = await readFile(new URL(`../src/pages/iptv-page/${file}.ts`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
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
  return module.namespace as T
}

/** 创建可以控制返回时机的播放地址解析请求 */
function deferredTarget(): { promise: Promise<Target>; resolve: (target: Target) => void } {
  let resolve!: (target: Target) => void
  const promise = new Promise<Target>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** 构造可取消抓帧与独立时钟，验证共享任务及并发限制 */
async function cacheFixture(): Promise<{
  api: CacheApi
  started: string[]
  released: string[]
  captures: Array<{ src: string; signal: AbortSignal; complete: (image: string) => void; fail: (error: Error) => void }>
  request: (key: string, controller?: AbortController) => Promise<string>
  target: (key: string) => Target
  advance: (ms: number) => void
}> {
  const started: string[] = []
  const released: string[] = []
  const captures: Array<{
    src: string
    signal: AbortSignal
    complete: (image: string) => void
    fail: (error: Error) => void
  }> = []
  let now = 0
  const api = await loadModule<CacheApi>(
    'preview-cache',
    {
      './preview-frame': {
        capturePreviewFrame: (src: string, _type: string, signal: AbortSignal) =>
          new Promise<string>((resolve, reject) => {
            signal.throwIfAborted()
            /** 模拟媒体抓帧在取消时结束 */
            const abort = (): void => reject(new DOMException('Aborted', 'AbortError'))
            signal.addEventListener('abort', abort, { once: true })
            captures.push({
              src,
              signal,
              complete: (image) => {
                signal.removeEventListener('abort', abort)
                resolve(image)
              },
              fail: (error) => {
                signal.removeEventListener('abort', abort)
                reject(error)
              },
            })
          }),
      },
    },
    { Date: { now: () => now } },
  )
  /** 构造可以核对释放次数的媒体会话 */
  const target = (key: string): Target => ({
    src: key,
    type: 'native',
    release: () => {
      released.push(key)
    },
  })
  return {
    api,
    started,
    released,
    captures,
    target,
    request: (key, controller = new AbortController()) =>
      api.getLivePreview(
        key,
        async () => {
          started.push(key)
          return target(key)
        },
        controller.signal,
      ),
    advance: (ms) => {
      now += ms
    },
  }
}

test('相同频道共用解析和抓帧，取消一个订阅不影响其他订阅，成功封面立即复用', async () => {
  const f = await cacheFixture()
  const controller = new AbortController()
  const first = f.request('a', controller)
  const cancelled = assert.rejects(first, { name: 'AbortError' })
  const second = f.request('a')
  await setImmediate()
  assert.deepEqual(f.started, ['a'])
  assert.equal(f.captures.length, 1)
  controller.abort()
  await cancelled
  assert.equal(f.captures[0].signal.aborted, false)
  f.captures[0].complete('cover-a')
  assert.equal(await second, 'cover-a')
  assert.equal(await f.request('a'), 'cover-a')
  assert.deepEqual(f.released, ['a'])
  assert.equal(f.started.length, 1)
})

test('最后一个订阅离开时取消抓帧，取消不会进入失败冷却', async () => {
  const f = await cacheFixture()
  const controller = new AbortController()
  const cancelled = assert.rejects(f.request('a', controller), { name: 'AbortError' })
  await setImmediate()
  controller.abort()
  await cancelled
  await setImmediate()
  assert.equal(f.captures[0].signal.aborted, true)
  assert.deepEqual(f.released, ['a'])
  const retry = f.request('a')
  await setImmediate()
  assert.equal(f.started.length, 2)
  f.captures[1].complete('retry-cover')
  assert.equal(await retry, 'retry-cover')
})

test('只运行两个任务，已离开可视区域的排队任务不会解析或抓帧', async () => {
  const f = await cacheFixture()
  const first = f.request('a')
  const second = f.request('b')
  const controller = new AbortController()
  const cancelled = assert.rejects(f.request('offscreen', controller), { name: 'AbortError' })
  const fourth = f.request('visible')
  await setImmediate()
  assert.deepEqual(f.started, ['a', 'b'])
  controller.abort()
  await cancelled
  f.captures[0].complete('a')
  await first
  await setImmediate()
  assert.deepEqual(f.started, ['a', 'b', 'visible'])
  f.captures[1].complete('b')
  f.captures[2].complete('visible')
  await Promise.all([second, fourth])
})

test('地址解析不能中断时维持真实并发上限，返回后释放旧会话而不抓帧', async () => {
  const f = await cacheFixture()
  const target = deferredTarget()
  const controller = new AbortController()
  const cancelled = assert.rejects(
    f.api.getLivePreview('slow', () => target.promise, controller.signal),
    { name: 'AbortError' },
  )
  const active = f.request('active')
  const next = f.request('next')
  await setImmediate()
  controller.abort()
  await cancelled
  await setImmediate()
  assert.deepEqual(f.started, ['active'])
  target.resolve(f.target('slow'))
  await setImmediate()
  assert.deepEqual(f.started, ['active', 'next'])
  assert.deepEqual(f.released, ['slow'])
  assert.deepEqual(
    f.captures.map((capture) => capture.src),
    ['active', 'next'],
  )
  f.captures[0].complete('active')
  f.captures[1].complete('next')
  await Promise.all([active, next])
})

test('获得槽位后立即取消的任务不解析地址，也不泄漏槽位', async () => {
  const f = await cacheFixture()
  const controller = new AbortController()
  const cancelled = assert.rejects(f.request('cancelled', controller), { name: 'AbortError' })
  controller.abort()
  await cancelled
  await setImmediate()
  const first = f.request('a')
  const second = f.request('b')
  await setImmediate()
  assert.deepEqual(f.started, ['a', 'b'])
  f.captures[0].complete('a')
  f.captures[1].complete('b')
  await Promise.all([first, second])
})

test('失败冷却 30 秒，手动刷新可以绕过冷却且不清除成功封面', async () => {
  const f = await cacheFixture()
  const good = f.request('good')
  await setImmediate()
  f.captures[0].complete('good-cover')
  await good
  const failed = assert.rejects(f.request('bad'), /预览失败/)
  await setImmediate()
  f.captures[1].fail(new Error('预览失败'))
  await failed
  await assert.rejects(f.request('bad'), /预览失败/)
  assert.equal(f.started.length, 2)
  f.advance(30_000)
  const expired = assert.rejects(f.request('bad'), /再次失败/)
  await setImmediate()
  f.captures[2].fail(new Error('再次失败'))
  await expired
  f.api.clearIptvPreviewFailures()
  const manual = f.request('bad')
  await setImmediate()
  f.captures[3].complete('manual-cover')
  assert.equal(await manual, 'manual-cover')
  assert.equal(f.api.readCachedLivePreview('good'), 'good-cover')
})

test('清空缓存后旧任务不能回填，新建的同频道任务仍可共享', async () => {
  const f = await cacheFixture()
  const target = deferredTarget()
  const old = assert.rejects(
    f.api.getLivePreview('a', () => target.promise, new AbortController().signal),
    { name: 'AbortError' },
  )
  await setImmediate()
  f.api.clearIptvPreviewCache()
  const replacement = f.request('a')
  target.resolve(f.target('old-a'))
  await old
  await setImmediate()
  const shared = f.request('a')
  await setImmediate()
  assert.equal(f.captures.length, 1)
  assert.deepEqual(f.released, ['old-a'])
  f.captures[0].complete('new-cover')
  assert.deepEqual(await Promise.all([replacement, shared]), ['new-cover', 'new-cover'])
  assert.equal(f.api.readCachedLivePreview('a'), 'new-cover')
})

test('成功封面缓存保持 120 条并优先保留最近访问的封面', async () => {
  const f = await cacheFixture()
  for (let index = 0; index < 120; index += 1) {
    const result = f.request(String(index))
    await setImmediate()
    f.captures[index].complete(`cover-${index}`)
    await result
  }
  assert.equal(f.api.readCachedLivePreview('0'), 'cover-0')
  const next = f.request('120')
  await setImmediate()
  f.captures[120].complete('cover-120')
  await next
  assert.equal(f.api.readCachedLivePreview('0'), 'cover-0')
  assert.equal(f.api.readCachedLivePreview('1'), undefined)
})

/** 构造可控制可视区域、页面可见性与停留时间的环境 */
async function visibilityFixture(): Promise<{
  observe: (element: Element, onChange: (visible: boolean) => void) => () => void
  intersect: (element: Element, visible: boolean) => void
  advance: (ms: number) => void
  hide: (hidden: boolean) => void
  readonly created: number
  readonly disconnected: number
}> {
  let now = 0
  let timerId = 0
  let created = 0
  let disconnected = 0
  const timers = new Map<number, { at: number; callback: () => void }>()
  const page = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  let callback: (entries: Array<{ target: Element; isIntersecting: boolean; intersectionRatio: number }>) => void
  class Observer {
    observed = new Set<Element>()
    /** 捕获观察回调以模拟真实的交叉区域变化 */
    constructor(onChange: typeof callback) {
      callback = onChange
      created += 1
    }
    /** 模拟开始观察卡片 */
    observe(element: Element): void {
      this.observed.add(element)
    }
    /** 模拟停止观察卡片 */
    unobserve(element: Element): void {
      this.observed.delete(element)
    }
    /** 记录最后一张卡片卸载后的观察器释放 */
    disconnect(): void {
      this.observed.clear()
      disconnected += 1
    }
  }
  const api = await loadModule<{
    observePreviewVisibility: (element: Element, onChange: (visible: boolean) => void) => () => void
  }>(
    'preview-visibility',
    {},
    {
      IntersectionObserver: Observer,
      document: page,
      setTimeout: (callback: () => void, delay: number) => {
        const id = ++timerId
        timers.set(id, { at: now + delay, callback })
        return id
      },
      clearTimeout: (id: number) => timers.delete(id),
    },
  )
  return {
    observe: api.observePreviewVisibility,
    intersect: (element, visible) =>
      callback([{ target: element, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 }]),
    advance: (ms) => {
      now += ms
      for (const [id, timer] of timers) {
        if (timer.at <= now) {
          timers.delete(id)
          timer.callback()
        }
      }
    },
    hide: (hidden) => {
      page.visibilityState = hidden ? 'hidden' : 'visible'
      page.dispatchEvent(new Event('visibilitychange'))
    },
    get created() {
      return created
    },
    get disconnected() {
      return disconnected
    },
  }
}

test('共用观察器，仅持续可见 250ms 的卡片启动，离开后立即取消', async () => {
  const f = await visibilityFixture()
  const a = {} as Element
  const b = {} as Element
  const calls: string[] = []
  const stopA = f.observe(a, (visible) => calls.push(`a:${visible}`))
  const stopB = f.observe(b, (visible) => calls.push(`b:${visible}`))
  assert.equal(f.created, 1)
  f.intersect(a, true)
  f.advance(249)
  assert.deepEqual(calls, [])
  f.intersect(a, false)
  f.advance(1)
  assert.deepEqual(calls, [])
  f.intersect(b, true)
  f.advance(250)
  assert.deepEqual(calls, ['b:true'])
  f.intersect(b, false)
  assert.deepEqual(calls, ['b:true', 'b:false'])
  stopA()
  assert.equal(f.disconnected, 0)
  stopB()
  assert.equal(f.disconnected, 1)
})

test('页面隐藏会取消预览，恢复后重新等待，卸载清除尚未触发的计时', async () => {
  const f = await visibilityFixture()
  const element = {} as Element
  const calls: boolean[] = []
  const stop = f.observe(element, (visible) => calls.push(visible))
  f.intersect(element, true)
  f.advance(250)
  f.hide(true)
  assert.deepEqual(calls, [true, false])
  f.hide(false)
  f.advance(249)
  assert.deepEqual(calls, [true, false])
  f.advance(1)
  assert.deepEqual(calls, [true, false, true])
  f.intersect(element, false)
  f.intersect(element, true)
  stop()
  f.advance(250)
  assert.deepEqual(calls, [true, false, true, false])
  assert.equal(f.disconnected, 1)
})

test('手动刷新不会再次订阅仍在释放会话的失败任务', async () => {
  const f = await cacheFixture()
  let finishRelease!: () => void
  const release = new Promise<void>((resolve) => {
    finishRelease = resolve
  })
  const failed = assert.rejects(
    f.api.getLivePreview(
      'a',
      async () => ({
        ...f.target('a'),
        release: () => release,
      }),
      new AbortController().signal,
    ),
    /抓帧失败/,
  )
  await setImmediate()
  f.captures[0].fail(new Error('抓帧失败'))
  await setImmediate()
  f.api.clearIptvPreviewFailures()
  const retry = f.request('a')
  await setImmediate()
  assert.equal(f.captures.length, 2)
  f.captures[1].complete('retry-cover')
  assert.equal(await retry, 'retry-cover')
  finishRelease()
  await failed
})

/** 构造首帧与取消事件可控的媒体元素，核对真实抓帧模块的清理 */
async function frameFixture(): Promise<{
  capture: (signal: AbortSignal) => Promise<string>
  video: EventTarget & { videoWidth: number; readyState: number }
  events: string[]
}> {
  const events: string[] = []
  class Video extends EventTarget {
    style = { cssText: '' }
    videoWidth = 1920
    videoHeight = 1080
    readyState = 0
    /** 记录开始播放 */
    play(): Promise<void> {
      events.push('play')
      return Promise.resolve()
    }
    /** 记录停止播放 */
    pause(): void {
      events.push('pause')
    }
    /** 记录清除播放地址 */
    removeAttribute(name: string): void {
      events.push(`remove:${name}`)
    }
    /** 记录释放媒体连接 */
    load(): void {
      events.push('load')
    }
    /** 记录隐藏媒体元素移除 */
    remove(): void {
      events.push('remove-video')
    }
  }
  const video = new Video()
  const api = await loadModule<{
    capturePreviewFrame: (src: string, type: string, signal: AbortSignal) => Promise<string>
  }>(
    'preview-frame',
    {
      'hls.js': { default: { isSupported: () => false } },
      'mpegts.js': { default: { isSupported: () => false } },
    },
    {
      window: { setTimeout, clearTimeout },
      document: {
        body: { append: () => events.push('append') },
        createElement: (tag: string) =>
          tag === 'video'
            ? video
            : {
                width: 0,
                height: 0,
                getContext: () => ({ drawImage: () => events.push('draw') }),
                toDataURL: () => 'data:image/jpeg;base64,preview',
              },
      },
    },
  )
  return { capture: (signal) => api.capturePreviewFrame('https://example.test/live', 'native', signal), video, events }
}

test('已准备好的首帧可直接抓取，并释放隐藏视频和媒体连接', async () => {
  const f = await frameFixture()
  f.video.readyState = 2
  assert.equal(await f.capture(new AbortController().signal), 'data:image/jpeg;base64,preview')
  assert.deepEqual(f.events, ['append', 'draw', 'pause', 'remove:src', 'load', 'remove-video'])
})

test('离开可视区域取消真实抓帧后，移除视频元素且不生成封面', async () => {
  const f = await frameFixture()
  const controller = new AbortController()
  const cancelled = assert.rejects(f.capture(controller.signal), { name: 'AbortError' })
  controller.abort()
  await cancelled
  assert.deepEqual(f.events, ['append', 'play', 'pause', 'remove:src', 'load', 'remove-video'])
  const beforeStart = new AbortController()
  beforeStart.abort()
  await assert.rejects(f.capture(beforeStart.signal), { name: 'AbortError' })
  assert.equal(f.events.length, 6)
})
