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
  build: {
    rollupOptions: {
      output: {
        // React en su chunk y recharts (con d3) en otro: recharts solo lo piden
        // el gráfico de Año y las pestañas Mes/Stats, nunca el arranque de la
        // app. Sin separar React, Rollup lo mete dentro del chunk de recharts.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react'
          if (/node_modules\/(recharts|d3-[^/]+|victory-vendor|recharts-scale|react-smooth|react-transition-group|decimal\.js-light|internmap|eventemitter3|fast-equals|lodash|tiny-invariant|clsx|prop-types|react-is)\//.test(id)) return 'vendor-recharts'
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      workbox: {
        runtimeCaching: [{
          urlPattern: /\.woff2$/,
          handler: 'CacheFirst',
          options: { cacheName: 'fonts', expiration: { maxEntries: 8, maxAgeSeconds: 31536000 } },
        }],
      },
      manifest: {
        name: 'Mi Economía',
        short_name: 'Mi Economía',
        description: 'Mi resumen financiero mensual',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
    }),
  ],
})
