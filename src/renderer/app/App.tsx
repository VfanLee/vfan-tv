import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { DisclaimerOverlay, ThemeProvider } from '../components'
import { DISCLAIMER_SKIP_STORAGE_KEY } from '@shared/constants'
import { AppRouter } from './routes/AppRouter'
import { useAppDataStore, useLayoutPreferencesStore, useThemeStore } from '@/stores'

function App(): React.JSX.Element {
  const mode = useThemeStore((state) => state.mode)
  const appStyle = useLayoutPreferencesStore((state) => state.appStyle)
  const initializeHomeData = useAppDataStore((state) => state.initialize)
  const [disclaimerDismissed, setDisclaimerDismissed] = useState(readDisclaimerPreference)

  useEffect(() => {
    if (appStyle === 'trending') void initializeHomeData()
  }, [appStyle, initializeHomeData])

  return (
    <ThemeProvider>
      <AppRouter />
      {disclaimerDismissed ? null : <DisclaimerOverlay onAcknowledge={() => setDisclaimerDismissed(true)} />}
      <Toaster richColors theme={mode === 'system' ? 'system' : mode} />
    </ThemeProvider>
  )
}

function readDisclaimerPreference(): boolean {
  try {
    return window.localStorage.getItem(DISCLAIMER_SKIP_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export default App
