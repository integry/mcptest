import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

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

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), learnSearchIndexDevServer()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return undefined
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
          if (id.includes('/bootstrap/') || id.includes('/@popperjs/')) return 'bootstrap'
          return 'vendor'
        }
      }
    }
  },
  test: {
    environment: 'jsdom'
  }
})
