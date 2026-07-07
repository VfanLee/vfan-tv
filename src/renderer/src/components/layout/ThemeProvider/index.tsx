import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useThemeStore } from '@renderer/stores/theme'

export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const mode = useThemeStore((state) => state.mode)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const applyTheme = (): void => {
      const shouldUseDarkClass = mode === 'dark' || (mode === 'system' && mediaQuery.matches)

      document.documentElement.dataset.theme = mode
      document.documentElement.classList.toggle('dark', shouldUseDarkClass)
    }

    applyTheme()
    mediaQuery.addEventListener('change', applyTheme)

    return () => mediaQuery.removeEventListener('change', applyTheme)
  }, [mode])

  return <>{children}</>
}
