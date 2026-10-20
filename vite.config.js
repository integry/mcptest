import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'

const SEARCH_INDEX_PATH = '/learn/search-index.json'

// The build writes dist/learn/search-index.json (scripts/generate-seo-pages.js);
// the dev server answers the same path from the same builder and articles.
const learnSearchIndexDevServer = () => ({
  name: 'learn-search-index-dev-server',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      if (request.url?.split('?')[0] !== SEARCH_INDEX_PATH) return next()
      try {
        const { LEARN_ARTICLES } = await server.ssrLoadModule('/src/content/learnRegistry.ts')
        const { buildSearchIndex, serializeSearchIndex } = await server.ssrLoadModule('/src/content/searchIndex.ts')
        response.setHeader('Content-Type', 'application/json')
        response.end(serializeSearchIndex(buildSearchIndex(LEARN_ARTICLES)))
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
    learnSearchIndexDevServer(),
    // Module-level sizes per chunk for scripts/bundle-graph.test.js and `npm run analyze`.
    visualizer({ template: 'raw-data', filename: 'dist/.vite/bundle-stats.json', gzipSize: false }),
  ],
  build: {
    // dist/.vite/manifest.json: the chunk graph scripts/bundle-graph.test.js asserts on.
    manifest: true,
    rollupOptions: {
      output: { manualChunks }
    }
  },
  test: {
    environment: 'jsdom'
  }
})
