import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'logo.png'],
      manifest: {
        name: 'Remote Claude',
        short_name: 'Remote Claude',
        description: 'Securely control Claude Code remotely from your phone. End-to-end encrypted.',
        theme_color: '#07070a',
        background_color: '#07070a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: 'favicon.png',
            sizes: '50x50',
            type: 'image/png'
          },
          {
            src: 'logo.png',
            sizes: '500x500',
            type: 'image/png'
          },
          {
            src: 'logo.png',
            sizes: '500x500',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    })
  ],
})
