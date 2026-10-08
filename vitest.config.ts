import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          // Vitest blanks CSS by default, `?raw` imports included. Let raw CSS through so tests can read the design tokens.
          css: { include: [/\.css\?raw$/] },
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          exclude: [...configDefaults.exclude, 'src/worker/**'],
        },
      },
      {
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.test.jsonc' } })],
        test: { name: 'worker', include: ['src/worker/**/*.test.ts'] },
      },
    ],
  },
})
