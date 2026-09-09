import '@fontsource-variable/noto-sans'
import '../styles/main.css'
import '../styles/custom.css'

import { initializeLogging } from '../platform/logging'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppErrorBoundary } from '../components'
import App from './App'
import { initializeUiPreferences, initializeRadioPreferences } from '../stores'

/** 启动日志转发并在模块替换时解除绑定 */
const disposeLogging = initializeLogging()
if (import.meta.hot) import.meta.hot.dispose(disposeLogging)

/** 完成持久化偏好加载后首次渲染，失败时提供重试入口 */
async function bootstrap(): Promise<void> {
  const root = createRoot(document.getElementById('root')!)
  try {
    await Promise.all([initializeUiPreferences(), initializeRadioPreferences()])
    root.render(
      <StrictMode>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </StrictMode>,
    )
  } catch (error) {
    console.error('应用初始化失败', error)
    root.render(
      <main role="alert" className="p-8">
        <p>无法读取应用设置，请重试</p>
        <button onClick={() => window.location.reload()}>重新加载</button>
      </main>,
    )
  }
}

void bootstrap()
