import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

function preloads(): Plugin {
  return {
    generateBundle(_options, bundle) {
      if (this.environment.name !== 'client') return
      const chunks = Object.values(bundle).filter((item) => item.type === 'chunk')
      const by = (test: (id: string) => boolean) => chunks.filter((chunk) => chunk.facadeModuleId && test(chunk.facadeModuleId))
      const closure = (roots: typeof chunks) => {
        const files = new Set<string>()
        const walk = (file: string) => {
          if (files.has(file)) return
          files.add(file)
          for (const next of chunks.find((chunk) => chunk.fileName === file)?.imports ?? []) walk(next)
        }
        for (const root of roots) walk(root.fileName)
        return [...files]
      }
      const highlighter = by((id) => /highlighter\/backends\/shiki\.js$|shiki\/dist\/(core|engine-javascript|langs)\.mjs$|@shikijs\/langs\/dist\/markdown\.mjs$|@pierre\/theme\/dist\/pierre-light\.mjs$|@pierre\/theming\/dist\/themes\.js$/.test(id))
      const code = closure([...by((id) => id.endsWith('/src/web/Code.tsx')), ...highlighter])
      const repo = closure(by((id) => id.endsWith('/src/web/Repo.tsx')))
      this.emitFile({ fileName: 'preload.json', source: JSON.stringify({ code, repo: [...new Set([...repo, ...code])] }), type: 'asset' })
    },
    name: 'swarms-preloads',
  }
}

export default defineConfig(({ command }) => {
  const gateway = command === 'serve' ? process.env['SWARMS_GATEWAY'] : undefined

  return {
    resolve: { alias: { '#ssr': fileURLToPath(new URL('./src/web/server.tsx', import.meta.url)) } },
    environments: { client: { build: { rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'hash', test: /\/viem\/_esm\/utils\/(hash\/keccak256|encoding\/toHex)\.js$/ }] } } } } } },
    server: { allowedHosts: ['terminal.local'] },
    plugins: [
      react(),
      preloads(),
      cloudflare({
        ...(process.env['SWARMS_STATE'] ? { persistState: { path: process.env['SWARMS_STATE'] } } : {}),
        ...(gateway
          ? {
              config: (config) => {
                config.vars = { ...config.vars, GATEWAY_URL: gateway }
                config.compatibility_flags = (config.compatibility_flags ?? []).filter(
                  (flag) => flag !== 'global_fetch_strictly_public',
                )
              },
            }
          : {}),
      }),
    ],
  }
})
