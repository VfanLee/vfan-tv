import { create } from 'zustand'
import { toast } from 'sonner'
import { isDesktopRuntime, listUiPreferences, listenUiPreferences, setUiPreference } from '@/platform/tauri'

export type ThemeMode = 'light' | 'dark' | 'system'
export type AppStyle = 'catalog' | 'trending'
export type ConfigurableNavigationItem = 'linkPlayer' | 'radio'

export interface NavigationVisibility {
  linkPlayer: boolean
  radio: boolean
}

interface PlayerPreferences {
  playbackRate: number
  seekStep: number
  loop: boolean
  autoNext: boolean
}

interface IptvSelection {
  channelId: string
  streamId: string
  expandedGroups: string[]
}

interface UiPreferencesState {
  player: PlayerPreferences
  iptvSourceId: string
  catalogSourceId: string
  iptvSelections: Record<string, IptvSelection>
  setPlayerPreference: <K extends keyof PlayerPreferences>(key: K, value: PlayerPreferences[K]) => void
  setIptvSourceId: (id: string) => void
  setCatalogSourceId: (id: string) => void
  setIptvSelection: (sourceId: string, selection: IptvSelection) => void

  mode: ThemeMode
  searchViewMode: 'grouped' | 'source'
  setSearchViewMode: (mode: 'grouped' | 'source') => void
  appStyle: AppStyle
  navigationVisibility: NavigationVisibility
  skipDisclaimer: boolean
  setMode: (mode: ThemeMode) => void
  setAppStyle: (style: AppStyle) => void
  setNavigationVisible: (item: ConfigurableNavigationItem, visible: boolean) => void
  setSkipDisclaimer: (skip: boolean) => Promise<void>
}

type StoredPreferences = Pick<
  UiPreferencesState,
  | 'mode'
  | 'appStyle'
  | 'navigationVisibility'
  | 'skipDisclaimer'
  | 'searchViewMode'
  | 'player'
  | 'iptvSourceId'
  | 'catalogSourceId'
  | 'iptvSelections'
>

/** 新安装或缺少字段时使用的界面偏好 */
const defaults: StoredPreferences = {
  player: { playbackRate: 1, seekStep: 5, loop: false, autoNext: true },
  iptvSourceId: '',
  catalogSourceId: '',
  iptvSelections: {},
  mode: 'system',
  searchViewMode: 'grouped',
  appStyle: 'catalog',
  navigationVisibility: { linkPlayer: false, radio: true },
  skipDisclaimer: false,
}

/** 按用户操作顺序提交偏好，单次失败不阻塞后续操作 */
let writes: Promise<void> = Promise.resolve()
/** 串行读取快照，避免旧响应覆盖新状态 */
let reads: Promise<void> = Promise.resolve()
/** 缓存初始化任务，避免重复注册窗口级监听 */
let initialization: Promise<void> | undefined

/** 保存成功后刷新内存状态，失败保留已持久化的值并提示 */
function savePreference(
  key: string,
  value: string | boolean | number | IptvSelection,
  scope = 'appearance',
): Promise<void> {
  const operation = writes.then(async () => {
    if (isDesktopRuntime()) {
      await setUiPreference(scope, key, typeof value === 'object' ? { ...value } : value)
      await refreshUiPreferences()
    } else {
      useUiPreferencesStore.setState((state) => mergePreference(state, key, value, scope))
    }
  })
  writes = operation.catch((error: unknown) => {
    toast.error('保存设置失败', { description: String(error) })
  })
  return operation
}

/** 校验数据库字段并合并为完整界面偏好 */
function mergePreference(
  state: StoredPreferences,
  key: string,
  value: unknown,
  scope = 'appearance',
): StoredPreferences {
  if (scope === 'player') {
    if (
      (key === 'playbackRate' && typeof value === 'number' && value >= 0.25 && value <= 3) ||
      (key === 'seekStep' && typeof value === 'number' && value >= 1 && value <= 30) ||
      ((key === 'loop' || key === 'autoNext') && typeof value === 'boolean')
    ) {
      return { ...state, player: { ...state.player, [key]: value } }
    }
    return state
  }
  if (scope === 'iptv' && key === 'selectedSource' && typeof value === 'string')
    return { ...state, iptvSourceId: value }
  if (scope === 'catalog' && key === 'selectedSource' && typeof value === 'string')
    return { ...state, catalogSourceId: value }
  if (scope === 'iptv-selection' && value && typeof value === 'object') {
    const item = value as Partial<IptvSelection>
    if (
      typeof item.channelId === 'string' &&
      typeof item.streamId === 'string' &&
      Array.isArray(item.expandedGroups) &&
      item.expandedGroups.every((group) => typeof group === 'string')
    ) {
      return {
        ...state,
        iptvSelections: {
          ...state.iptvSelections,
          [key]: { channelId: item.channelId, streamId: item.streamId, expandedGroups: item.expandedGroups },
        },
      }
    }
  }
  if (scope !== 'appearance') return state
  if (key === 'searchViewMode' && (value === 'grouped' || value === 'source'))
    return { ...state, searchViewMode: value }
  if (key === 'theme' && (value === 'light' || value === 'dark' || value === 'system')) {
    return { ...state, mode: value }
  } else if (key === 'appStyle' && (value === 'catalog' || value === 'trending')) {
    return { ...state, appStyle: value }
  } else if ((key === 'linkPlayer' || key === 'radio') && typeof value === 'boolean') {
    return { ...state, navigationVisibility: { ...state.navigationVisibility, [key]: value } }
  } else if (key === 'skipDisclaimer' && typeof value === 'boolean') {
    return { ...state, skipDisclaimer: value }
  }
  return state
}

/** 统一维护由 SQLite 持久化的外观与启动偏好 */
export const useUiPreferencesStore = create<UiPreferencesState>(() => ({
  ...defaults,
  setPlayerPreference: (key, value) => {
    void savePreference(key, value, 'player').catch(() => {})
  },
  setIptvSourceId: (id) => {
    void savePreference('selectedSource', id, 'iptv').catch(() => {})
  },
  setCatalogSourceId: (id) => {
    void savePreference('selectedSource', id, 'catalog').catch(() => {})
  },
  setIptvSelection: (sourceId, selection) => {
    void savePreference(sourceId, selection, 'iptv-selection').catch(() => {})
  },
  setSearchViewMode: (mode) => {
    void savePreference('searchViewMode', mode).catch(() => {})
  },
  setMode: (mode) => {
    void savePreference('theme', mode).catch(() => {})
  },
  setAppStyle: (style) => {
    void savePreference('appStyle', style).catch(() => {})
  },
  setNavigationVisible: (item, visible) => {
    void savePreference(item, visible).catch(() => {})
  },
  setSkipDisclaimer: (skip) => savePreference('skipDisclaimer', skip),
}))

/** 从数据库刷新完整快照，删除的偏好恢复默认值 */
function refreshUiPreferences(): Promise<void> {
  const operation = reads.then(async () => {
    const scopes = ['appearance', 'player', 'iptv', 'catalog', 'iptv-selection']
    const groups = await Promise.all(
      scopes.map(async (scope) => ({ scope, preferences: await listUiPreferences(scope) })),
    )
    const snapshot = groups.reduce(
      (state, group) =>
        group.preferences.reduce(
          (current, preference) => mergePreference(current, preference.key, preference.value, group.scope),
          state,
        ),
      defaults,
    )
    useUiPreferencesStore.setState(snapshot)
  })
  reads = operation.catch(() => {})
  return operation
}

/** 在首次渲染前加载偏好，并在窗口生命周期内同步数据库变更 */
export function initializeUiPreferences(): Promise<void> {
  if (!isDesktopRuntime()) return Promise.resolve()
  initialization ??= (async () => {
    const unlisten = await listenUiPreferences(() => {
      void refreshUiPreferences().catch((error: unknown) => {
        toast.error('同步设置失败', { description: String(error) })
      })
    })
    try {
      await refreshUiPreferences()
    } catch (error) {
      unlisten()
      throw error
    }
    window.addEventListener('pagehide', unlisten, { once: true })
    import.meta.hot?.dispose(unlisten)
  })().catch((error: unknown) => {
    initialization = undefined
    throw error
  })
  return initialization
}
