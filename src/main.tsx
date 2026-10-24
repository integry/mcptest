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
const staticPage = getDeferredStaticPage(root)
if (staticPage) {
  enhanceStaticPage(staticPage)
  const mountNow = deferMountUntilInput({
    root,
    prepare: prepareApp,
    isHandled: isHandledByStaticPage,
    snapshotState: snapshotStaticPageState,
  })
  // The header shows the signed-in user, which only the app knows.
  if (restoringSession) mountNow()
} else {
  prepareApp()
    .then(render => render())
    .catch(error => console.error('[Startup] The app failed to mount.', error))
}
