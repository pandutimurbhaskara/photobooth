import { describe, expect, it } from 'vitest'
import css from '../index.css?raw'
import { PALETTE } from './palette'

describe('PALETTE', () => {
  it('equals the CSS colour tokens, so the strip and the page can never drift apart', () => {
    for (const [name, hex] of Object.entries(PALETTE)) expect(css).toContain(`--color-${name}: ${hex};`)
  })
})
