import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Configuración aparte de vite.config.js para no cargar el plugin PWA en los tests.
export default defineConfig({
  plugins: [react()],
  define: { __BUILD_SHA__: '"test"', __BUILD_TIME__: '"test"' },
  test: {
    include: ['tests/**/*.test.{js,jsx}'],
    environment: 'jsdom',
  },
})
