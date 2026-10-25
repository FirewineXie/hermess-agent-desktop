import { execFileSync } from 'node:child_process'
import { copyFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
export const upstream = resolve(root, 'upstream/hermes-agent')
export const patch = resolve(root, 'adapters/hermess_desktop_private_api.patch')
export const adapter = resolve(root, 'adapters/hermess_private_api.py')
export const installedAdapter = resolve(upstream, 'hermes_cli/hermess_private_api.py')

const normalized = value => value.replaceAll('\r\n', '\n').trimEnd() + '\n'
const git = (...args) => execFileSync('git', ['-C', upstream, ...args], { encoding: 'utf8' })

export function verifyAdapter() {
  const actual = normalized(git('diff', '--unified=0', '--binary'))
  const expected = normalized(readFileSync(patch, 'utf8'))
  if (actual !== expected) throw new Error('上游工作树与产品适配补丁不一致')
  if (git('diff', '--cached', '--name-only').trim()) throw new Error('上游工作树有暂存改动')
  if (git('ls-files', '--others', '--exclude-standard').trim() !== 'hermes_cli/hermess_private_api.py') {
    throw new Error('上游工作树有非产品适配文件')
  }
  if (!readFileSync(installedAdapter).equals(readFileSync(adapter))) {
    throw new Error('上游工作树的 Hermess 适配文件与产品源码不一致')
  }
}
export function applyAdapter() {
  const status = git('status', '--porcelain', '--untracked-files=all').trim()
  if (!status) {
    execFileSync('git', ['-C', upstream, 'apply', '--unidiff-zero', patch], { stdio: 'inherit' })
    copyFileSync(adapter, installedAdapter)
  }
  verifyAdapter()
}
