import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setImmediate } from 'node:timers/promises'
import { test } from 'node:test'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'
import ts from 'typescript'

/** 加载真实播放器私有模块，以可控依赖验证资源和交接流程 */
async function loadModule(
  file: string,
  dependencies: Record<string, Record<string, unknown>>,
): Promise<SourceTextModule> {
  const context = createContext({ console: { error: () => {} }, crypto: { randomUUID: () => 'session' } })
  const source = await readFile(new URL(`../src/components/basic-player/utils/${file}.ts`, import.meta.url), 'utf8')
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
  return module
}

/** 建立可模拟 HLS 事件的引擎环境，不创建真实播放器或窗口 */
async function engineFixture(supported = true): Promise<{
  start: (live?: boolean, native?: boolean) => void
  emit: (event: string, data?: object) => void
  release: () => void
  events: string[]
  failures: string[]
  tracks: boolean[]
  setTracks: (count: number) => void
  video: { src: string }
}> {
  const events: string[] = []
  const failures: string[] = []
  const tracks: boolean[] = []
  const handlers = new Map<string, (event: string, data?: object) => void>()
  class FakeHls {
    static Events = {
      MANIFEST_PARSED: 'manifest',
      LEVEL_SWITCHED: 'level',
      AUDIO_TRACK_SWITCHED: 'audio',
      LEVEL_LOADED: 'loaded',
      ERROR: 'error',
    }
    static ErrorTypes = { NETWORK_ERROR: 'network' }
    /** 控制是否可使用浏览器 HLS 引擎 */
    static isSupported(): boolean {
      return supported
    }
    levels = []
    audioTracks: object[] = []
    /** 注册测试可触发的引擎事件 */
    on(event: string, callback: (event: string, data?: object) => void): void {
      handlers.set(event, callback)
    }
    /** 记录清单加载请求 */
    loadSource(): void {
      events.push('load')
    }
    /** 记录媒体元素挂载 */
    attachMedia(): void {
      events.push('attach')
    }
    /** 记录网络恢复请求 */
    startLoad(): void {
      events.push('retry')
    }
    /** 记录引擎销毁 */
    destroy(): void {
      events.push('destroy')
    }
  }
  const module = await loadModule('playback-engine', {
    'hls.js': { default: FakeHls },
    'mpegts.js': { default: {} },
    './playback-debug': {
      formatUnknownErrorInfo: String,
      formatHlsErrorBrief: String,
      formatHlsPlaybackFailureReason: () => 'fatal',
    },
  })
  const api = module.namespace as {
    createHlsPlayback: (...args: unknown[]) => void
    destroyHls: (ref: { current: FakeHls | null }) => void
  }
  const hlsRef = { current: new FakeHls() as FakeHls | null }
  const mpegtsRef = {
    current: {
      unload: () => events.push('unload'),
      detachMediaElement: () => events.push('detach'),
      destroy: () => events.push('mpegts-destroy'),
    },
  }
  const video = { src: '', canPlayType: () => '' }
  return {
    start: (live = true, native = false) => {
      video.canPlayType = () => (native ? 'probably' : '')
      api.createHlsPlayback(
        video,
        'https://example.test/live.m3u8',
        {},
        live,
        hlsRef,
        mpegtsRef,
        { push: () => {} },
        (_art: unknown, reason: string) => failures.push(reason),
        () => {},
        (available: boolean) => tracks.push(available),
      )
    },
    emit: (event, data) => handlers.get(event)?.(event, data),
    release: () => api.destroyHls(hlsRef),
    setTracks: (count) => {
      if (hlsRef.current) hlsRef.current.audioTracks = Array.from({ length: count }, () => ({}))
    },
    events,
    failures,
    tracks,
    video,
  }
}

test('切换 HLS 前释放旧引擎，销毁幂等，单音轨不显示切换入口', async () => {
  const fixture = await engineFixture()
  fixture.start()
  assert.deepEqual(fixture.events, ['destroy', 'unload', 'detach', 'mpegts-destroy', 'load', 'attach'])
  fixture.setTracks(1)
  fixture.emit('manifest')
  fixture.setTracks(2)
  fixture.emit('manifest')
  assert.deepEqual(fixture.tracks, [false, true])
  fixture.release()
  fixture.release()
  assert.equal(fixture.events.filter((event) => event === 'destroy').length, 2)
})

test('直播 HLS 网络错误最多连续恢复两次，成功加载后重置计数', async () => {
  const fixture = await engineFixture()
  fixture.start()
  const error = { fatal: true, type: 'network' }
  fixture.emit('error', error)
  fixture.emit('error', error)
  fixture.emit('error', error)
  assert.equal(fixture.events.filter((event) => event === 'retry').length, 2)
  assert.equal(fixture.failures.length, 1)
  fixture.emit('loaded')
  fixture.emit('error', error)
  assert.equal(fixture.events.filter((event) => event === 'retry').length, 3)
  const vod = await engineFixture()
  vod.start(false)
  vod.emit('error', error)
  assert.deepEqual(vod.failures, ['fatal'])
  assert.ok(!vod.events.includes('retry'))
})

test('无 HLS.js 时使用原生 HLS，不支持时明确上报失败', async () => {
  const native = await engineFixture(false)
  native.start(true, true)
  assert.equal(native.video.src, 'https://example.test/live.m3u8')
  assert.equal(native.failures.length, 0)
  const unsupported = await engineFixture(false)
  unsupported.start()
  assert.equal(unsupported.failures.length, 1)
})

test('小窗交接读取点击时的进度，阻止重复交接，失败后恢复主播放器', async () => {
  let rejectHandoff: (error: Error) => void = () => {}
  const requests: unknown[] = []
  const module = await loadModule('mini-window', {
    'react': { useEffect: () => {}, useRef: () => {} },
    '@/platform/api': {
      onMiniWindowModeExit: () => {},
      enterMiniWindowMode: (input: unknown) => {
        requests.push(input)
        return new Promise((_resolve, reject) => {
          rejectHandoff = reject
        })
      },
    },
    '@/utils': { artplayerControlIcons: { miniWindow: '' } },
    './playback-engine': { reloadPlayback: () => {} },
  })
  const api = module.namespace as { createMiniWindowControl: (...args: unknown[]) => Array<{ click: () => void }> }
  const sessionRef = { current: undefined as string | undefined }
  let time = 10
  let pauses = 0
  let plays = 0
  const player = {
    pause: () => {
      pauses += 1
    },
    play: async () => {
      plays += 1
    },
    notice: { show: '' },
  }
  const [control] = api.createMiniWindowControl(
    () => player,
    sessionRef,
    () => ({ initialTime: time }),
  )
  time = 42
  control.click()
  control.click()
  assert.equal(requests.length, 1)
  assert.equal((requests[0] as { initialTime: number }).initialTime, 42)
  assert.equal(pauses, 1)
  rejectHandoff(new Error('handoff failed'))
  await setImmediate()
  assert.equal(sessionRef.current, undefined)
  assert.equal(plays, 1)
  assert.match(player.notice.show, /进入小窗模式失败/)
})
