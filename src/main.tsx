import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/jetbrains-mono/wght.css'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.min.css'
import './index.css'
// The prerendered home page paints the landing before the playground chunk
// arrives; its styles must travel with the shell stylesheet, not that chunk.
import './components/LandingHero.css'
import { loadFirebase, scheduleAnalyticsLoad, shouldRestoreAuthSession } from './firebase'
import { deferMountUntilInput } from './staticPage/deferredMount'
import { enhanceStaticPage, getDeferredStaticPage, isHandledByStaticPage, snapshotStaticPageState } from './staticPage/staticPage'
import { canonicalAliasPath } from './utils/appRoutes'

/*
 * The entry stays small: React, the router and the app are one dynamic
 * import away (src/bootstrapApp.tsx). App routes mount at once. Prerendered
 * content pages (guides, the Learn index, server profiles) are complete
 * without React, so they mount on the first input instead (issue #405).
 */
const prepareApp = () => import('./bootstrapApp').then(module => module.prepareApp())

// A served alias of a page (/catalog.html, /learn/index.html) takes the
// page's canonical URL before anything reads the path, so the app renders the
// page rather than NotFound.
const canonicalPath = canonicalAliasPath(window.location.pathname)
if (canonicalPath) {
  window.history.replaceState(window.history.state, '', `${canonicalPath}${window.location.search}${window.location.hash}`)
}

// A returning signed-in user: fetch Firebase now, alongside the app.
const restoringSession = shouldRestoreAuthSession()
if (restoringSession) loadFirebase().catch(() => {})
// Analytics loads once the page is idle; earlier events are queued.
scheduleAnalyticsLoad()

const root = document.getElementById('root')!
const deferredPage = getDeferredStaticPage(root)
// The home HTML also serves SPA routes. Their actual views must mount at once.
const staticPage = deferredPage?.querySelector('.seo-landing-fallback') && window.location.pathname !== '/'
  ? null : deferredPage
// The catalog fallback represents only the default list. Query URLs need
// React to apply their filters without waiting for the visitor's first input.
// Served aliases have already been canonicalized above.
const catalogParams = new URLSearchParams(window.location.search)
const hasCatalogFilters = window.location.pathname.startsWith('/catalog')
  && (Boolean(catalogParams.get('q')?.trim())
    || ['auth', 'category', 'sort'].some(key => {
      const value = catalogParams.get(key)
      const defaultValue = key === 'sort' ? 'catalog-order' : 'all'
      return Boolean(value) && value !== defaultValue
    }))
if (staticPage) {
  enhanceStaticPage(staticPage)
  const mountNow = deferMountUntilInput({
    root,
    prepare: prepareApp,
    isHandled: isHandledByStaticPage,
    snapshotState: snapshotStaticPageState,
  })
  // The header shows the signed-in user, which only the app knows.
  // Returning workspaces and connection deep links still restore immediately.
  const restoringWorkspace = window.location.pathname === '/'
    && document.documentElement.getAttribute('data-returning-visitor') === 'true'
  if (restoringSession || restoringWorkspace || hasCatalogFilters) mountNow()
} else {
  prepareApp()
    .then(render => render())
    .catch(error => console.error('[Startup] The app failed to mount.', error))
}
