import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isDesktopRuntime } from '../tauri'
import type {
  MediaProbeInput,
  MediaProbeResult,
  SearchEvent,
  VodCatalogPage,
  VodCatalogRequest,
  VodSearchResult,
} from '@/types'

/** 先登记搜索标识并等待事件监听就绪，再启动后端任务 */
export async function searchVod(
  keyword: string,
  onStarted?: (id: string) => void,
): Promise<{ searchId: string } | undefined> {
  if (isDesktopRuntime()) {
    const searchId = crypto.randomUUID()
    await ensureSearchListener()
    onStarted?.(searchId)
    return invoke('search_vod', { keyword, searchId })
  }
  return undefined
}

/** 取消当前窗口的搜索任务 */
export async function cancelVodSearch(searchId: string): Promise<void> {
  if (isDesktopRuntime()) return invoke('cancel_vod_search', { searchId })
  throw new Error('当前运行环境不支持此操作')
}

/** 加载点播目录分页 */
export function getVodCatalogPage(input: VodCatalogRequest): Promise<VodCatalogPage> {
  if (isDesktopRuntime()) return invoke('get_vod_catalog_page', { input })
  throw new Error('当前运行环境不支持此操作')
}

/** 加载指定视频的完整详情 */
export function getVodDetail(sourceId: string, vodId: string): Promise<VodSearchResult> {
  if (isDesktopRuntime()) return invoke('get_vod_detail', { sourceId, vodId })
  throw new Error('当前运行环境不支持此操作')
}

/** 探测线路响应延迟与 HLS 分辨率 */
export async function probeMediaSource(input: MediaProbeInput): Promise<MediaProbeResult | undefined> {
  if (isDesktopRuntime()) return invoke('probe_media_source', { input })
  return undefined
}

/** 订阅窗口内的搜索进度，卸载时移除业务监听 */
export function onVodSearchEvent(listener: (event: SearchEvent) => void): () => void {
  if (isDesktopRuntime()) {
    searchListeners.add(listener)
    void ensureSearchListener().catch((error: unknown) => console.error('搜索监听注册失败', error))
    return () => {
      searchListeners.delete(listener)
    }
  }
  return () => {}
}

/** 窗口共享一个原生监听，业务订阅随页面卸载释放 */
const searchListeners = new Set<(event: SearchEvent) => void>()
let searchListener: Promise<UnlistenFn> | undefined

/** 等待原生监听注册，失败后允许重试 */
function ensureSearchListener(): Promise<UnlistenFn> {
  searchListener ??= listen<SearchEvent>('vod-search-event', ({ payload }) => {
    for (const listener of searchListeners) listener(payload)
  }).catch((error: unknown) => {
    searchListener = undefined
    throw error
  })
  return searchListener
}

/** 在窗口销毁或热更新时释放原生监听 */
function releaseSearchListener(): void {
  void searchListener?.then((release) => release()).catch(() => {})
  searchListeners.clear()
  searchListener = undefined
}
window.addEventListener('pagehide', releaseSearchListener, { once: true })
import.meta.hot?.dispose(releaseSearchListener)
