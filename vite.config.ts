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
    // 默认目标是 Safari 16，而线上真有人用更老的 iOS。
    // 降到 15 只是多降级一点语法，换来老机器上不会整个 bundle 解析失败。
    build: {
      target: ['es2020', 'safari15'],
    },
    plugins: [
      react(),
      tailwindcss(),
      turtleSoupApi(env),
      {
        // 把 build id 写进 HTML：内联自愈脚本要在 bundle 之外读到它
        name: 'inject-build-meta',
        transformIndexHtml: (html: string) =>
          html.replace(
            '<!--build:meta-->',
            `<meta name="build" content="${pkg.version}+${buildId()}" />`,
          ),
      },
    ],
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
