import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { archiveStore } from '@/lib/archive-store'
import '@/lib/pwa-install'

declare global {
  interface Window {
    __tsBooted?: boolean
    __tsCanReload?: () => boolean
    __tsAssetError?: unknown
  }
}

// Boot clears the slow-loading notice, but keeps the cooldown against reload loops.
window.__tsBooted = true
window.__tsCanReload = () => !archiveStore().storageError
window.dispatchEvent(new Event('turtle-soup:booted'))
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { installErrorReporting } from '@/lib/telemetry'
import { I18nProvider } from '@/components/I18nProvider'
import { ThemeProvider } from '@/components/ThemeProvider'
import { CrashNote } from '@/components/CrashNote'

// 钩子要赶在第一次渲染之前装好，否则最早的错误抓不到
installErrorReporting()

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {
      // Private browsing or disabled service workers must not block the website.
    })
  })
}

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
