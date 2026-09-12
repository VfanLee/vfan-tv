import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { DisclaimerOverlay, ThemeProvider } from '../components'
import { AppRouter } from './routes/AppRouter'
import { useAppDataStore, useAppUpdateSync, useThemeStore } from '@/stores'
import { listSources, onAppDataChange } from '@/platform/api'
import { clearVodCatalogPages, pruneVodCatalogPages } from '@/platform/cache/recommendation-cache'
import { clearVodCategoryCache, pruneVodCategoryCache } from '@/platform/cache/vod-catalog-categories'
import { TooltipProvider } from '@/ui'

/** 组装应用路由、主题与提示组件 */
function App(): React.JSX.Element {
  const mode = useThemeStore((state) => state.mode)
  const skipDisclaimer = useThemeStore((state) => state.skipDisclaimer)
  const [disclaimerDismissed, setDisclaimerDismissed] = useState(false)
  const isAuxiliaryWindow = /^#\/(settings|mini-window)(?:[?/]|$)/.test(window.location.hash)

  useAppUpdateSync(!isAuxiliaryWindow)

  /** 在所有窗口同步推荐缓存失效，页面离开后仍能接收设置窗口的数据变更 */
  useEffect(() => {
    let active = true
    let requestId = 0
    const unsubscribe = onAppDataChange((domain) => {
      if (domain === 'app-data') {
        requestId += 1
        clearVodCatalogPages()
        clearVodCategoryCache()
        useAppDataStore.getState().clearRecommendationCache()
      } else if (domain === 'vod-sources') {
        const request = ++requestId
        void listSources()
          .then((sources) => {
            if (!active || request !== requestId) return
            pruneVodCatalogPages(sources)
            pruneVodCategoryCache(sources)
          })
          .catch((error: unknown) => console.error('同步推荐缓存失败', error))
      }
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

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
