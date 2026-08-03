import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { setMediaProxyBaseUrl } from '@shared/utils/media-image'
import { ThemeProvider } from './components/theme-provider'
import { AppRouter } from './routes/AppRouter'
import { getMediaProxyBaseUrl } from './services/api'
import { useAppDataStore, useLayoutPreferencesStore, useThemeStore } from '@/stores'

function App(): React.JSX.Element {
  const mode = useThemeStore((state) => state.mode)
  const appStyle = useLayoutPreferencesStore((state) => state.appStyle)
  const initializeAppData = useAppDataStore((state) => state.initialize)
  const [isMediaProxyReady, setIsMediaProxyReady] = useState(false)

  useEffect(() => {
    if (appStyle === 'trending') void initializeAppData()
  }, [appStyle, initializeAppData])

  useEffect(() => {
    let active = true

    void getMediaProxyBaseUrl()
      .then(setMediaProxyBaseUrl)
      .finally(() => {
        if (active) {
          setIsMediaProxyReady(true)
        }
      })

    return () => {
      active = false
    }
  }, [])

  if (!isMediaProxyReady) {
    return <div className="bg-background min-h-screen" />
  }

  return (
    <ThemeProvider>
      <AppRouter />
      <Toaster richColors theme={mode === 'system' ? 'system' : mode} />
    </ThemeProvider>
  )
}

export default App
