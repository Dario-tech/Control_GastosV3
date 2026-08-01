import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Vercel expone esto como variable de entorno SOLO durante el build (no en
// runtime), así que hay que "hornearlo" en el bundle con `define`. Sirve
// para comprobar desde la propia app qué commit está desplegado de verdad,
// sin depender de leer bien el dashboard de Vercel.
const commitSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.npm_package_gitHead || 'local'

export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(commitSha.slice(0, 7)),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Control de Gastos 2025',
        short_name: 'Gastos',
        description: 'Mi resumen financiero mensual',
        theme_color: '#1a1f2e',
        background_color: '#0f1117',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="40" fill="%235b7cff"/><text x="96" y="135" font-size="110" text-anchor="middle" fill="white">💰</text></svg>',
            sizes: '192x192',
            type: 'image/svg+xml',
          },
        ],
      },
    }),
  ],
})
