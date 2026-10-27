import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const upstream = execFileSync('git', ['-C', resolve(root, 'upstream/hermes-agent'), 'show', 'HEAD:LICENSE'])
const bundled = readFileSync(resolve(root, 'legal/hermes-agent-LICENSE'))
if (!upstream.equals(bundled)) {
  throw new Error('The bundled Hermes Agent license differs from the locked upstream checkout')
}
console.log('Bundled Hermes Agent license matches the locked upstream checkout')
