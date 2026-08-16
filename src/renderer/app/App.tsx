import { useState } from 'react'
import { Toaster } from 'sonner'
import { DisclaimerOverlay, ThemeProvider } from '../components'
import { DISCLAIMER_SKIP_STORAGE_KEY } from '@shared/constants'
import { AppRouter } from './routes/AppRouter'
import { useAppUpdateSync, useLayoutPreferencesSync, useThemeStore, useThemeSync } from '@/stores'
import { TooltipProvider } from '@/ui'

function App(): React.JSX.Element {
  const mode = useThemeStore((state) => state.mode)
  const [disclaimerDismissed, setDisclaimerDismissed] = useState(readDisclaimerPreference)
  const isSettingsWindow = window.location.hash.startsWith('#/settings')

  useAppUpdateSync(!isSettingsWindow)
  useLayoutPreferencesSync()
  useThemeSync()

  return (
    <ThemeProvider>
      <TooltipProvider>
        <AppRouter />
        {disclaimerDismissed || isSettingsWindow ? null : (
          <DisclaimerOverlay onAcknowledge={() => setDisclaimerDismissed(true)} />
        )}
        <Toaster richColors theme={mode === 'system' ? 'system' : mode} />
      </TooltipProvider>
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
