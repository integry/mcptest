import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
