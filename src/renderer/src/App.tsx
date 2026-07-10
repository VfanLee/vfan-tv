import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { setMediaProxyBaseUrl } from '@shared/utils/media-image'
import { ThemeProvider } from './components/layout/theme-provider'
import { AppRouter } from './routes/AppRouter'
import { getMediaProxyBaseUrl } from './services/api'
import { useThemeStore } from './stores/theme'
import { useAppDataStore } from './stores/app-data'

function App(): React.JSX.Element {
  const mode = useThemeStore((state) => state.mode)
  const initializeAppData = useAppDataStore((state) => state.initialize)
  const [isMediaProxyReady, setIsMediaProxyReady] = useState(false)

  useEffect(() => {
    void initializeAppData()
  }, [initializeAppData])

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
