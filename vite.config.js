import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig(({ mode }) => {
  // Załaduj zmienne środowiskowe
  const env = loadEnv(mode, process.cwd(), '')
  
  return {
    plugins: [
      react(),
      nodePolyfills({
        // Włącz wszystkie potrzebne polyfille
        include: ['crypto', 'stream', 'assert', 'http', 'https', 'os', 'url', 'zlib', 'path', 'buffer', 'process'],
        globals: {
          Buffer: true,
          global: true,
          process: true,
        },
        protocolImports: true,
      }),
    ],
    define: {
      'process.env.REACT_APP_SOLANA_NETWORK': JSON.stringify(env.REACT_APP_SOLANA_NETWORK || 'devnet'),
      'process.env.REACT_APP_PROGRAM_ID': JSON.stringify(env.REACT_APP_PROGRAM_ID || '11111111111111111111111111111111'),
      'process.env.REACT_APP_GAME_SERVER_URL': JSON.stringify(env.REACT_APP_GAME_SERVER_URL || 'http://localhost:3001'),
      global: 'globalThis',
    },
    resolve: {
      alias: {
        buffer: 'buffer',
      },
    },
    server: {
      port: 3000,
    },
    optimizeDeps: {
      include: ['buffer', 'process'],
      esbuildOptions: {
        define: {
          global: 'globalThis',
        },
        loader: {
          '.js': 'jsx',
        },
      },
    },
    esbuild: {
      loader: 'jsx',
      include: /src\/.*\.jsx?$/,
      exclude: [],
    },
  }
})