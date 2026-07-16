import './styles/main.css'
import './styles/custom.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppErrorBoundary } from './components'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
