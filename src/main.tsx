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
import { capturePrerenderedCatalog, STATIC_CATALOG_SEARCH_ATTRIBUTE } from './staticPage/prerenderedCatalog'
import { canonicalAliasPath } from './utils/appRoutes'
import { startSiteAssistant } from './siteAssistant/siteAssistant'
import { APP_ROUTE_OPTIONS } from './servicePage/buildFlag'

/*
 * The entry stays small: React, the router and the app are one dynamic
 * import away (src/bootstrapApp.tsx). App routes mount at once. Prerendered
 * content pages (guides, the Learn index, server profiles) are complete
 * without React, so they wait for an interaction that needs the app.
 */
const prepareApp = () => import('./bootstrapApp').then(module => module.prepareApp())

// A served alias of a page (/catalog.html, /learn/index.html) takes the
// page's canonical URL before anything reads the path, so the app renders the
// page rather than NotFound.
const canonicalPath = canonicalAliasPath(window.location.pathname, APP_ROUTE_OPTIONS)
if (canonicalPath) {
  window.history.replaceState(window.history.state, '', `${canonicalPath}${window.location.search}${window.location.hash}`)
}

// Restore a docked assistant at startup, or offer its launcher after idle.
startSiteAssistant()

// A returning signed-in user: fetch Firebase now, alongside the app.
const restoringSession = shouldRestoreAuthSession()
if (restoringSession) loadFirebase().catch(() => {})
// Analytics loads once the page is idle; earlier events are queued.
scheduleAnalyticsLoad()

const root = document.getElementById('root')!
const scrollKeys = new Set([' ', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
const isScrollKey = (event: Event): event is KeyboardEvent =>
  event instanceof KeyboardEvent && event.type === 'keydown'
  && !event.altKey && !event.ctrlKey && !event.metaKey && scrollKeys.has(event.key)

// Let native keyboard scrolling start in the content column without stealing
// focus on load or changing the behavior of an already focused control.
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || !isScrollKey(event)) return
  if (document.activeElement !== document.body) return
  root.querySelector<HTMLElement>('.main-content')?.focus({ preventScroll: true })
})

root.addEventListener('scroll', event => {
  const panel = event.target
  if (!(panel instanceof HTMLElement) || !panel.classList.contains('main-content')) return
  const header = panel.closest('.app-shell')?.querySelector('.app-header')
  if (panel.scrollTop > 0) header?.setAttribute('data-scrolled', 'true')
  else header?.removeAttribute('data-scrolled')
}, { capture: true, passive: true })

const deferredPage = getDeferredStaticPage(root)
// The home HTML also serves SPA routes. Their actual views must mount at once.
const staticPage = deferredPage?.querySelector('.seo-landing-fallback') && window.location.pathname !== '/'
  ? null : deferredPage
// Filtered catalog URLs mount immediately so the app can apply the full URL
// state, including authentication, sort order and legacy category links.
// Served aliases have already been canonicalized above.
const catalogParams = new URLSearchParams(window.location.search)
const isCatalog = window.location.pathname === '/catalog' || window.location.pathname.startsWith('/catalog/')
const hasCatalogFilters = isCatalog
  && (Boolean(catalogParams.get('q')?.trim())
    || ['auth', 'category', 'sort'].some(key => {
      const value = catalogParams.get(key)
      const defaultValue = key === 'sort' ? 'catalog-order' : 'all'
      return Boolean(value) && value !== defaultValue
    }))
if (staticPage) {
  capturePrerenderedCatalog(root, window.location.pathname)
  const mountNow = deferMountUntilInput({
    root,
    prepare: prepareApp,
    isHandled: isHandledByStaticPage,
    snapshotState: snapshotStaticPageState,
    // The catalog search and links already work on the prerendered page.
    // Tab can move from search into the app's other filter controls.
    shouldStartOnInput: event => {
      const target = event.target
      if (!(target instanceof Element)) return true
      // Keep native scrolling on the static page until an input needs React.
      if (isScrollKey(event) && (target === document.body || target.matches('.main-content'))) return false
      if (!isCatalog) return true
      // The assistant's settings handshake runs independently of the catalog.
      if (!root.contains(target)) {
        return event.type === 'keydown' && (target === document.body || target === document.documentElement)
      }
      if (target.closest(`[${STATIC_CATALOG_SEARCH_ATTRIBUTE}]`)) {
        return event instanceof KeyboardEvent && event.key === 'Tab'
      }
      if (target.closest('[data-static-catalog-clear]')) return false
      return event.type !== 'pointerdown' || Boolean(target.closest('.catalog-filters, button, input, select, textarea'))
    },
  })
  enhanceStaticPage(staticPage)
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
