import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyPrefs, loadPrefs } from './lib/prefs'
import { installTapFeedback } from './lib/tap'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/app.css'
import './styles/pages.css'

applyPrefs(loadPrefs())
installTapFeedback()

// Surface runtime failures to the browser tests instead of letting them fail silently.
const errorWindow = window as Window & { __nestoryErrors?: string[] }
errorWindow.__nestoryErrors = []
const rememberError = (message: string) => {
  // Chrome emits this harmless scheduling warning when observers resize synchronously.
  if (message.includes('ResizeObserver loop')) return
  if (errorWindow.__nestoryErrors!.length >= 20) return
  errorWindow.__nestoryErrors!.push(message)
}
window.addEventListener('error', (event) => {
  rememberError(event.message || 'Unknown error')
})
window.addEventListener('unhandledrejection', (event) => {
  rememberError(String(event.reason ?? 'Unhandled rejection'))
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
