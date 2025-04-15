import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Configure the server to proxy requests to the backend Express server
    proxy: {
      '/sse': 'http://localhost:3000' // Assuming your Express server runs on port 3000
    }
  }
})