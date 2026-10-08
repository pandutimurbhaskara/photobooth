import { describe, expect, it } from 'vitest'
import rootPackage from '../../../package.json?raw'
import installed from '../../../node_modules/@mediapipe/tasks-vision/package.json?raw'
import { MEDIAPIPE_BASE, MEDIAPIPE_VERSION } from './vendor'

describe('vendored MediaPipe', () => {
  it('is pinned exactly, so the version in the asset path cannot drift from the dependency', () => {
    const dependencies = (JSON.parse(rootPackage) as { dependencies: Record<string, string> }).dependencies
    expect(dependencies['@mediapipe/tasks-vision']).toBe(MEDIAPIPE_VERSION)
    expect((JSON.parse(installed) as { version: string }).version).toBe(MEDIAPIPE_VERSION)
    expect(MEDIAPIPE_BASE).toBe(`/vendor/mediapipe-${MEDIAPIPE_VERSION}`)
  })
})
