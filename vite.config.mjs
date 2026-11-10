import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The Node content loader, shared with scripts/generate-seo-pages.js.
const require = createRequire(import.meta.url)
const rootDir = path.dirname(fileURLToPath(import.meta.url))
const ARTICLES_DIR = path.join(rootDir, 'src', 'content', 'articles')
const PAGE_METADATA_PATH = path.join(rootDir, 'src', 'data', 'pageMetadata.json')

const SEARCH_INDEX_PATH = '/learn/search-index.json'
const ARTICLE_INDEX_ID = 'virtual:learn-article-index'
const RESOLVED_ARTICLE_INDEX_ID = `\0${ARTICLE_INDEX_ID}`

/** Articles parsed and validated by the Node loader; React-only docs pages reserve their paths. */
/** Versions the unhashed theme-init.js URL in index.html (scripts/theme-init-version.js). */
const versionedThemeInit = () => ({
  name: 'versioned-theme-init',
  transformIndexHtml(html) {
    const { versionThemeInitTag } = require('./scripts/theme-init-version.js')
    return versionThemeInitTag(html, fs.readFileSync(path.join(rootDir, 'public', 'theme-init.js')))
  },
})

const loadContent = () => {
  const { loadArticleIndex, loadArticles } = require('./scripts/content/loadArticles.js')
  const pageMetadata = JSON.parse(fs.readFileSync(PAGE_METADATA_PATH, 'utf8'))
  const options = { reservedPaths: Object.keys(pageMetadata.docs).map(slug => `/docs/${slug}`) }
  return { loadArticleIndex: () => loadArticleIndex(options), loadArticles: () => loadArticles(options) }
}

/**
 * `virtual:learn-article-index`: every guide's frontmatter, outline and
 * code-block flag, parsed and validated here at build time, so the browser
 * neither parses frontmatter nor ships the bodies up front. A bad article
 * fails the build. Bodies load on demand through the lazy glob in
 * src/content/learnRegistry.ts.
 */
const learnArticleIndex = () => ({
  name: 'learn-article-index',
  resolveId(id) {
    return id === ARTICLE_INDEX_ID ? RESOLVED_ARTICLE_INDEX_ID : undefined
  },
  load(id) {
    if (id !== RESOLVED_ARTICLE_INDEX_ID) return undefined
    for (const file of fs.readdirSync(ARTICLES_DIR)) {
      if (file.endsWith('.md')) this.addWatchFile(path.join(ARTICLES_DIR, file))
    }
    this.addWatchFile(PAGE_METADATA_PATH)
    const index = loadContent().loadArticleIndex()
    return `export default ${JSON.stringify(index)}`
  },
  configureServer(server) {
    // An added, edited or removed article rebuilds the index on the next request.
    const refresh = (file) => {
      if (path.dirname(file) !== ARTICLES_DIR || !file.endsWith('.md')) return
      const module = server.moduleGraph.getModuleById(RESOLVED_ARTICLE_INDEX_ID)
      if (!module) return
      server.moduleGraph.invalidateModule(module)
      server.ws.send({ type: 'full-reload' })
    }
    server.watcher.add(ARTICLES_DIR)
    for (const event of ['add', 'change', 'unlink']) server.watcher.on(event, refresh)
  },
})

// The build writes dist/learn/search-index.json (scripts/generate-seo-pages.js);
// the dev server answers the same path from the same builder and articles.
const learnSearchIndexDevServer = () => ({
  name: 'learn-search-index-dev-server',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      if (request.url?.split('?')[0] !== SEARCH_INDEX_PATH) return next()
      try {
        const { buildSearchIndex, serializeSearchIndex } = await server.ssrLoadModule('/src/content/searchIndex.ts')
        response.setHeader('Content-Type', 'application/json')
        response.end(serializeSearchIndex(buildSearchIndex(loadContent().loadArticles())))
      } catch (error) {
        next(error)
      }
    })
  },
})

const nodeModule = (...families) => (id) =>
  id.includes('/node_modules/')
  // Stylesheets are emitted as CSS; their placeholder modules must not pin a JS chunk.
  && !/\.(css|scss|sass|less)(\?|$)/.test(id)
  && families.some(family => id.includes(family))

/**
 * Pinned chunks, most shared first. Only the named families are pinned; every
 * other dependency follows Rolldown's own graph, so a library used only by a
 * lazily loaded view (highlight.js, the JSON Schema evaluator, the MCP SDK)
 * is never bundled into a chunk the entry imports. A catch-all "vendor"
 * chunk would do exactly that and ship the inspector to every page.
 *
 * A Rolldown group also captures the static dependencies of the modules it
 * matches, so a group claims what it shares with a later one: the order below
 * is the priority. "runtime" holds Vite's own helpers (dynamic-import
 * preloading, the modulepreload polyfill), which the entry and the vendor
 * chunks share; claimed by a vendor chunk instead, they would make the entry
 * import that whole chunk just for them. React comes before the Markdown
 * renderer, which imports react/jsx-runtime.
 */
const CHUNK_GROUPS = [
  { name: 'runtime', test: /^\0vite\/(preload-helper|modulepreload-polyfill)\.js$/ },
  { name: 'react', test: nodeModule('/react/', '/react-dom/', '/react-router/', '/react-router-dom/', '/scheduler/') },
  { name: 'firebase', test: nodeModule('/firebase/', '/@firebase/') },
  { name: 'mcp-sdk', test: nodeModule('/@modelcontextprotocol/', '/zod/') },
  { name: 'markdown', test: nodeModule('/react-markdown/', '/remark-', '/unified/', '/micromark', '/mdast-', '/hast-') },
  { name: 'highlight', test: nodeModule('/highlight.js/') },
  { name: 'bootstrap', test: nodeModule('/bootstrap/', '/@popperjs/') },
].map((group, index, groups) => ({ ...group, priority: groups.length - index }))

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    learnArticleIndex(),
    learnSearchIndexDevServer(),
    versionedThemeInit(),
    // Module-level sizes per chunk for scripts/bundle-graph.test.js and `npm run analyze`.
    visualizer({ template: 'raw-data', filename: 'dist/.vite/bundle-stats.json', gzipSize: false }),
  ],
  build: {
    // dist/.vite/manifest.json: the chunk graph scripts/bundle-graph.test.js asserts on.
    manifest: true,
    // One stylesheet for the whole app. The entry no longer imports App
    // statically (src/main.tsx), so split CSS would move most rules into a
    // chunk stylesheet that only arrives with the app. The generator inlines
    // each page's critical subset and preloads this file instead
    // (scripts/critical-css.js), so it no longer blocks the first paint.
    cssCodeSplit: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: CHUNK_GROUPS,
        },
      },
    },
  },
  test: {
    environment: 'jsdom'
  }
})
