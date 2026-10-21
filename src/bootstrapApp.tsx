import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { capturePrerenderedArticle } from './content/prerenderedArticle'
import { preloadViewsForPath } from './views/deferredViews'

/**
 * The app itself, loaded by src/main.tsx: at once on the playground and the
 * other app routes, on first input over a prerendered content page.
 */

/** Resolves after the tree above it has committed and run its effects. */
const OnCommit: React.FC<{ onCommit: () => void }> = ({ onCommit }) => {
  useEffect(() => onCommit(), [onCommit])
  return null
}

const STYLESHEET_TIMEOUT_MS = 10000

/**
 * The full stylesheet arrives as a preload that public/theme-init.js applies
 * (scripts/critical-css.js); the page's inline CSS covers only its static
 * first frame, so React does not render before the rest has applied.
 */
const waitForDeferredStylesheets = (): Promise<void> => {
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[data-deferred-stylesheet]'))
  return Promise.all(links.map(link => new Promise<void>((resolve) => {
    const applied = () => link.rel === 'stylesheet' && link.sheet !== null
    if (applied()) {
      resolve()
      return
    }
    const timer = window.setTimeout(done, STYLESHEET_TIMEOUT_MS)
    function done() {
      window.clearTimeout(timer)
      link.removeEventListener('load', check)
      link.removeEventListener('error', done)
      resolve()
    }
    function check() {
      if (applied()) done()
    }
    link.addEventListener('load', check)
    link.addEventListener('error', done)
  }))).then(() => undefined)
}

/**
 * Fetches the view chunks the current route renders first and the full
 * stylesheet, then returns the function that mounts. The mount replaces the
 * static HTML with the finished view in one frame rather than a loading
 * fallback. A failed preload still mounts; the lazy component retries the
 * download when it renders.
 */
export const prepareApp = async (): Promise<() => Promise<void>> => {
  const rootElement = document.getElementById('root')!
  // The guide body the generator prerendered; LearnArticlePage keeps it rather than rendering the Markdown again.
  capturePrerenderedArticle(rootElement)
  await Promise.all([
    preloadViewsForPath(window.location.pathname, window.location.search)
      .catch(error => console.warn('[Startup] View chunk preload failed; mounting anyway.', error)),
    waitForDeferredStylesheets(),
  ])
  return () => new Promise<void>((resolve) => {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <BrowserRouter>
          <AuthProvider>
            <App />
            <OnCommit onCommit={resolve} />
          </AuthProvider>
        </BrowserRouter>
      </React.StrictMode>,
    )
  })
}
