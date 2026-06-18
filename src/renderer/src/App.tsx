import { useEffect } from 'react'
import { Toaster } from 'sonner'
import { ThemeProvider } from './components/layout/ThemeProvider'
import { AppRouter } from './routes/AppRouter'
import { useThemeStore } from './stores/theme'
import { useAppDataStore } from './stores/app-data'

function App(): React.JSX.Element {
  const mode = useThemeStore((state) => state.mode)
  const initializeAppData = useAppDataStore((state) => state.initialize)

  useEffect(() => {
    void initializeAppData()
  }, [initializeAppData])

  return (
    <ThemeProvider>
      <AppRouter />
      <Toaster richColors theme={mode === 'system' ? 'system' : mode} />
    </ThemeProvider>
  )
}

export default App
