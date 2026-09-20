import { execSync } from 'node:child_process'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

import pkg from './package.json' with { type: 'json' }

function buildId(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'dev'
  }
}
import { turtleSoupApi } from './server/index.ts'

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }

  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __BUILD_ID__: JSON.stringify(buildId()),
    },
    plugins: [react(), tailwindcss(), turtleSoupApi(env)],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    server: {
      port: 5173,
    },
  }
})
