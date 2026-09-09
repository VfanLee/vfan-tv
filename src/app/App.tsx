import { useState } from 'react'
import { Toaster } from 'sonner'
import { DisclaimerOverlay, ThemeProvider } from '../components'
import { AppRouter } from './routes/AppRouter'
import { useAppUpdateSync, useThemeStore } from '@/stores'
import { TooltipProvider } from '@/ui'

/** 组装应用路由、主题与提示组件 */
function App(): React.JSX.Element {
  const mode = useThemeStore((state) => state.mode)
  const skipDisclaimer = useThemeStore((state) => state.skipDisclaimer)
  const [disclaimerDismissed, setDisclaimerDismissed] = useState(false)
  const isAuxiliaryWindow = /^#\/(settings|mini-window)(?:[?/]|$)/.test(window.location.hash)

  useAppUpdateSync(!isAuxiliaryWindow)

  return (
    <ThemeProvider>
      <TooltipProvider>
        <AppRouter />
        {skipDisclaimer || disclaimerDismissed || isAuxiliaryWindow ? null : (
          <DisclaimerOverlay onAcknowledge={() => setDisclaimerDismissed(true)} />
        )}
        <Toaster richColors theme={mode === 'system' ? 'system' : mode} />
      </TooltipProvider>
    </ThemeProvider>
  )
}

export default App
