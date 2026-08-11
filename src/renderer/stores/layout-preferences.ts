import { useEffect } from 'react'
import { create } from 'zustand'
import { LAYOUT_PREFERENCES_STORAGE_KEY } from '@shared/constants'

export type AppStyle = 'catalog' | 'trending'
export type ConfigurableNavigationItem = 'linkPlayer' | 'radio'

export interface NavigationVisibility {
  linkPlayer: boolean
  radio: boolean
}

interface StoredLayoutPreferences {
  appStyle: AppStyle
  navigationVisibility: NavigationVisibility
  version: 2
}

interface LayoutPreferencesState extends Omit<StoredLayoutPreferences, 'version'> {
  setAppStyle: (appStyle: AppStyle) => void
  setNavigationVisible: (item: ConfigurableNavigationItem, visible: boolean) => void
}

const defaultPreferences: StoredLayoutPreferences = {
  appStyle: 'catalog',
  navigationVisibility: { linkPlayer: false, radio: true },
  version: 2,
}

const initialPreferences = readLayoutPreferences()

export const useLayoutPreferencesStore = create<LayoutPreferencesState>((set) => ({
  appStyle: initialPreferences.appStyle,
  navigationVisibility: initialPreferences.navigationVisibility,
  setAppStyle: (appStyle) => {
    set((state) => {
      const next = { ...state, appStyle }
      persistLayoutPreferences(next)
      return { appStyle }
    })
  },
  setNavigationVisible: (item, visible) => {
    set((state) => {
      const navigationVisibility = { ...state.navigationVisibility, [item]: visible }
      persistLayoutPreferences({ ...state, navigationVisibility })
      return { navigationVisibility }
    })
  },
}))

export function useLayoutPreferencesSync(): void {
  /** 监听本地存储变化并同步布局偏好 */
  useEffect(() => {
    const synchronize = (event: StorageEvent): void => {
      if (event.key !== null && event.key !== LAYOUT_PREFERENCES_STORAGE_KEY) return
      const preferences = readLayoutPreferences()
      useLayoutPreferencesStore.setState({
        appStyle: preferences.appStyle,
        navigationVisibility: preferences.navigationVisibility,
      })
    }
    window.addEventListener('storage', synchronize)
    return () => window.removeEventListener('storage', synchronize)
  }, [])
}

function readLayoutPreferences(): StoredLayoutPreferences {
  if (typeof window === 'undefined') return defaultPreferences

  try {
    const raw = window.localStorage.getItem(LAYOUT_PREFERENCES_STORAGE_KEY)
    if (!raw) return defaultPreferences
    const parsed = JSON.parse(raw) as {
      appStyle?: unknown
      navigationVisibility?: Record<string, unknown>
      version?: unknown
    }
    if (parsed.appStyle !== 'catalog' && parsed.appStyle !== 'trending') {
      return defaultPreferences
    }
    const visibility = parsed.navigationVisibility
    if (!visibility || typeof visibility.linkPlayer !== 'boolean' || typeof visibility.radio !== 'boolean') {
      return defaultPreferences
    }
    if (parsed.version !== 1 && parsed.version !== 2) return defaultPreferences
    return {
      appStyle: parsed.appStyle,
      navigationVisibility: { linkPlayer: visibility.linkPlayer, radio: visibility.radio },
      version: 2,
    }
  } catch {
    return defaultPreferences
  }
}

function persistLayoutPreferences(state: Pick<LayoutPreferencesState, 'appStyle' | 'navigationVisibility'>): void {
  try {
    const stored: StoredLayoutPreferences = {
      appStyle: state.appStyle,
      navigationVisibility: state.navigationVisibility,
      version: 2,
    }
    window.localStorage.setItem(LAYOUT_PREFERENCES_STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // localStorage 不可用时仍保留当前会话内的 Zustand 状态。
  }
}
