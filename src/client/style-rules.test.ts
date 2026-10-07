import { describe, expect, it } from 'vitest'

// Every client source file, as text. This test enforces the brief's hard design rules so a stray
// utility class cannot quietly turn the app into a glassy SaaS dashboard.
const files = import.meta.glob('./**/*.{ts,tsx,css}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const sources = Object.entries(files).filter(([path]) => !path.endsWith('.test.ts'))

const RULES: Array<[string, RegExp]> = [
  ['no blur (no glassmorphism)', /backdrop-blur|(?<![\w-])blur-|blur\(/],
  ['no gradients', /gradient/i],
  ['no soft shadows (hard offset shadows only)', /(?<![\w-])(?:drop-)?shadow-(?:xs|sm|md|lg|xl|2xl|inner)(?![\w-])/],
  ['no big or pill radii (8px maximum)', /(?<![\w-])rounded-(?:xl|2xl|3xl|full)(?![\w-])/],
]

describe('neo-brutalist style rules', () => {
  it('actually scans the client source', () => {
    expect(sources.length).toBeGreaterThan(15)
  })
  for (const [name, pattern] of RULES) {
    it(name, () => {
      expect(sources.filter(([, text]) => pattern.test(text)).map(([path]) => path)).toEqual([])
    })
  }
})
