import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const vendor = resolve(root, 'vendor/hermes-agent')
const lock = JSON.parse(readFileSync(resolve(root, 'runtime/upstream.lock.json'), 'utf8'))
const git = (...args) => execFileSync('git', ['-C', vendor, ...args], { encoding: 'utf8' }).trim()
const actual = git('rev-parse', 'HEAD')
if (actual !== lock.commit) throw new Error(`上游提交不匹配：${actual}`)
const changed = git('status', '--porcelain', '--untracked-files=all')
if (changed) throw new Error(`上游源码有改动：\n${changed}`)
const expected = execFileSync('git', ['-C', root, 'ls-files', '--stage', 'vendor/hermes-agent'], { encoding: 'utf8' }).trim()
if (!expected.includes(lock.commit)) throw new Error('Git submodule 指针与锁文件不一致；先 git add vendor/hermes-agent')
console.log(`上游源码与 submodule 指针一致：${actual}`)
