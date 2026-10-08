import { describe, expect, it } from 'vitest'
import headers from '../../public/_headers?raw'

function directive(name: string): string[] {
  const line = headers.split('\n').find((l) => l.trim().startsWith('Content-Security-Policy:')) ?? ''
  const policy = line.replace(/^\s*Content-Security-Policy:/, '')
  const part = policy
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name} `))
  return part ? part.split(/\s+/).slice(1) : []
}

describe('Content-Security-Policy', () => {
  it('allows compiling WebAssembly (the cutout model) but never eval(), and still no inline scripts', () => {
    const script = directive('script-src')
    expect(script).toContain("'self'")
    expect(script).toContain("'wasm-unsafe-eval'")
    expect(script).not.toContain("'unsafe-eval'")
    expect(script).not.toContain("'unsafe-inline'")
  })
  it('keeps everything else on this origin: the model and runtime are self-hosted', () => {
    expect(directive('default-src')).toEqual(["'self'"])
    expect(directive('connect-src')).not.toContain('https:')
    expect(directive('connect-src')).not.toContain('*')
  })
  it('caches the versioned vendor files for a year, immutable', () => {
    expect(headers).toMatch(/\/vendor\/\*\s*\n\s+Cache-Control: public, max-age=31536000, immutable/)
  })
})
