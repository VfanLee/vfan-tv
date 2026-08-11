import { useEffect } from 'react'
import { create } from 'zustand'
import { THEME_STORAGE_KEY } from '@shared/constants'

export type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeState {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
}

function readInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'system'
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
  return storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system' ? storedTheme : 'system'
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: readInitialTheme(),
  setMode: (mode) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode)
    set({ mode })
  },
}))

export function useThemeSync(): void {
  /** 监听本地存储变化并同步主题模式 */
  useEffect(() => {
    const synchronize = (event: StorageEvent): void => {
      if (event.key !== null && event.key !== THEME_STORAGE_KEY) return
      useThemeStore.setState({ mode: readInitialTheme() })
    }
    window.addEventListener('storage', synchronize)
    return () => window.removeEventListener('storage', synchronize)
  }, [])
}
