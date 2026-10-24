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

/**
 * Vendor chunks by library family. Only the named families are pinned; every
 * other dependency follows Rollup's own graph, so a library used only by a
 * lazily loaded view (highlight.js, the JSON Schema evaluator, the MCP SDK)
 * is never bundled into a chunk the entry imports. A catch-all "vendor"
 * chunk would do exactly that and ship the inspector to every page.
 */
const manualChunks = (id) => {
  // Vite's own helpers (dynamic-import preloading, CommonJS interop) are shared
  // by the entry and the vendor chunks; pinned so Rollup never files them under
  // a vendor chunk, which would make the entry import that chunk just for them.
  if (/^\0(vite\/preload-helper|vite\/modulepreload-polyfill|commonjsHelpers)\.js$/.test(id)) return 'runtime'
  // Stylesheets are emitted as CSS; their placeholder modules must not pin a JS chunk.
  if (!id.includes('/node_modules/') || /\.(css|scss|sass|less)(\?|$)/.test(id)) return undefined
  if (id.includes('/firebase/') || id.includes('/@firebase/')) return 'firebase'
  if (id.includes('/@modelcontextprotocol/') || id.includes('/zod/')) return 'mcp-sdk'
  if (
    id.includes('/react/')
    || id.includes('/react-dom/')
    || id.includes('/react-router/')
    || id.includes('/react-router-dom/')
    || id.includes('/scheduler/')
  ) return 'react'
  if (
    id.includes('/react-markdown/')
    || id.includes('/remark-')
    || id.includes('/unified/')
    || id.includes('/micromark')
    || id.includes('/mdast-')
    || id.includes('/hast-')
  ) return 'markdown'
  if (id.includes('/highlight.js/')) return 'highlight'
  if (id.includes('/bootstrap/') || id.includes('/@popperjs/')) return 'bootstrap'
  return undefined
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    learnArticleIndex(),
    learnSearchIndexDevServer(),
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
    rollupOptions: {
      output: { manualChunks }
    }
  },
  test: {
    environment: 'jsdom'
  }
})
