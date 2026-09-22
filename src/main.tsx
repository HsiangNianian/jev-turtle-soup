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
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { installErrorReporting } from '@/lib/telemetry'
import { I18nProvider } from '@/components/I18nProvider'
import { ThemeProvider } from '@/components/ThemeProvider'
import { CrashNote } from '@/components/CrashNote'

// 钩子要赶在第一次渲染之前装好，否则最早的错误抓不到
installErrorReporting()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <ErrorBoundary fallback={<CrashNote />}>
          <App />
        </ErrorBoundary>
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
)
