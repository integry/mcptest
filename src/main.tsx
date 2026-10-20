import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/jetbrains-mono/wght.css'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.min.css'
import App from './App'
import './index.css'
// The prerendered home page paints the landing before the playground chunk
// arrives; its styles must travel with the shell stylesheet, not that chunk.
import './components/LandingHero.css'
import { AuthProvider } from './context/AuthContext'
import { loadFirebase, scheduleAnalyticsLoad, shouldRestoreAuthSession } from './firebase'
import { preloadViewsForPath } from './views/deferredViews'

const mount = () => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </React.StrictMode>,
  )
}

// A returning signed-in user: fetch Firebase now, alongside the view chunk.
if (shouldRestoreAuthSession()) loadFirebase().catch(() => {})
// Analytics loads once the page is idle; earlier events are queued.
scheduleAnalyticsLoad()

// The view this route renders first is fetched before React mounts, so the
// mount replaces the prerendered HTML with the finished view in one frame
// rather than with a loading fallback. A failed preload still mounts; the
// lazy component retries the download when it renders.
preloadViewsForPath(window.location.pathname, window.location.search)
  .catch(error => console.warn('[Startup] View chunk preload failed; mounting anyway.', error))
  .then(mount)
