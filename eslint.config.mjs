import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores(['dist', '.wrangler', '.superpowers', 'worker-configuration.d.ts', 'playwright-report', 'test-results', 'node_modules', 'coverage']),
  js.configs.recommended,
  tseslint.configs.recommended,
  { files: ['src/client/**/*.{ts,tsx}'], languageOptions: { globals: globals.browser } },
  {
    files: ['src/client/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' },
  },
  { files: ['src/worker/**/*.ts', 'src/shared/**/*.ts'], languageOptions: { globals: globals.worker } },
  { files: ['*.config.ts', 'e2e/**/*.ts'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
])
