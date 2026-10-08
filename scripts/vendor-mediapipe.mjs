// Copies the MediaPipe WASM runtime out of node_modules into public/vendor/ (git-ignored: ~26 MB), and checks the
// committed model. Runs on `npm install` (postinstall) so CI and Workers Builds get it too. It fails loudly: a build
// without these files would ship a cutout feature that can never load.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'node_modules/@mediapipe/tasks-vision/package.json'), 'utf8'))
const FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']
const MODEL = join(root, 'public/vendor/models/selfie_segmenter.tflite')
const MODEL_BYTES = 249_537

const from = join(root, 'node_modules/@mediapipe/tasks-vision/wasm')
const to = join(root, `public/vendor/mediapipe-${pkg.version}`)
mkdirSync(to, { recursive: true })
for (const name of FILES) {
  const src = join(from, name)
  if (!existsSync(src)) throw new Error(`vendor: ${name} is missing from @mediapipe/tasks-vision ${pkg.version}`)
  const dst = join(to, name)
  if (!existsSync(dst) || statSync(dst).size !== statSync(src).size) copyFileSync(src, dst)
}
if (!existsSync(MODEL) || statSync(MODEL).size !== MODEL_BYTES) {
  throw new Error(`vendor: public/vendor/models/selfie_segmenter.tflite must exist and be ${MODEL_BYTES} bytes`)
}
console.log(`vendor: MediaPipe ${pkg.version} runtime is in public/vendor/mediapipe-${pkg.version}`)
