import { create } from 'zustand'
import { LAYOUT_PREFERENCES_STORAGE_KEY } from '@shared/constants'

export type AppStyle = 'catalog' | 'trending'
export type ConfigurableNavigationItem = 'favorites' | 'linkPlayer' | 'radio' | 'recent'

export interface NavigationVisibility {
  favorites: boolean
  linkPlayer: boolean
  radio: boolean
  recent: boolean
}

interface StoredLayoutPreferences {
  appStyle: AppStyle
  navigationVisibility: NavigationVisibility
  version: 1
}

interface LayoutPreferencesState extends Omit<StoredLayoutPreferences, 'version'> {
  setAppStyle: (appStyle: AppStyle) => void
  setNavigationVisible: (item: ConfigurableNavigationItem, visible: boolean) => void
}

const defaultPreferences: StoredLayoutPreferences = {
  appStyle: 'catalog',
  navigationVisibility: { favorites: true, linkPlayer: false, radio: true, recent: true },
  version: 1,
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

function readLayoutPreferences(): StoredLayoutPreferences {
  if (typeof window === 'undefined') return defaultPreferences

  try {
    const raw = window.localStorage.getItem(LAYOUT_PREFERENCES_STORAGE_KEY)
    if (!raw) return defaultPreferences
    const parsed = JSON.parse(raw) as Partial<StoredLayoutPreferences>
    if (parsed.version !== 1 || (parsed.appStyle !== 'catalog' && parsed.appStyle !== 'trending')) {
      return defaultPreferences
    }
    const visibility = parsed.navigationVisibility
    if (
      !visibility ||
      typeof visibility.favorites !== 'boolean' ||
      typeof visibility.linkPlayer !== 'boolean' ||
      typeof visibility.radio !== 'boolean' ||
      typeof visibility.recent !== 'boolean'
    ) {
      return defaultPreferences
    }
    return { appStyle: parsed.appStyle, navigationVisibility: visibility, version: 1 }
  } catch {
    return defaultPreferences
  }
}

function persistLayoutPreferences(state: Pick<LayoutPreferencesState, 'appStyle' | 'navigationVisibility'>): void {
  try {
    const stored: StoredLayoutPreferences = {
      appStyle: state.appStyle,
      navigationVisibility: state.navigationVisibility,
      version: 1,
    }
    window.localStorage.setItem(LAYOUT_PREFERENCES_STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // localStorage 不可用时仍保留当前会话内的 Zustand 状态。
  }
}
