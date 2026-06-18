import { create } from 'zustand'
import { THEME_STORAGE_KEY } from '@shared/constants/storage-keys'

export type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeState {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
}

function readInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light'
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
  return storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system' ? storedTheme : 'light'
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: readInitialTheme(),
  setMode: (mode) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode)
    set({ mode })
  },
}))
