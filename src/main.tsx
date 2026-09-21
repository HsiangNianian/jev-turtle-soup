import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

declare global {
  interface Window {
    __tsBooted?: boolean
  }
}

// 启动成功：清掉自愈标记，让下次部署还能触发一次恢复
window.__tsBooted = true
try {
  sessionStorage.removeItem('ts-asset-recovery')
} catch {
  /* 隐私模式下忽略 */
}
import { I18nProvider } from '@/components/I18nProvider'
import { ThemeProvider } from '@/components/ThemeProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
)
