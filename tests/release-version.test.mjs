import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const source = fileURLToPath(new URL('../scripts/release-version.mjs', import.meta.url))
const tag = 'v0.1.8-rc.3'
const forkLine = '- 基于 Hermes Agent v0.22.5；fork hermess-desktop（882037eb8745b505db438217513c4c94f95c93c1）。'
const notes = selectedTag => `# Hermess Agent Desktop ${selectedTag}\n\n## 新增功能\n\n- 新增桌面功能。\n\n## 修复问题\n\n- 修复桌面问题。\n\n## Hermes fork 版本\n\n${forkLine}\n`

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'hermess-release-version-'))
  const files = {
    'scripts/release-version.mjs': readFileSync(source),
    'package.json': '{"name":"hermess-agent-desktop","private":true}\n',
    'apps/desktop/package.json': '{"name":"@hermess/desktop","private":true}\n',
    'apps/desktop/src-tauri/tauri.conf.json': '{"productName":"Hermess Agent Desktop"}\n',
    'apps/desktop/src-tauri/Cargo.toml': '[package]\nname = "hermess-agent-desktop"\nversion = "0.0.0"\nedition = "2021"\n\n[dependencies]\n',
    'apps/desktop/src-tauri/Cargo.lock': 'version = 4\n\n[[package]]\nname = "hermess-agent-desktop"\nversion = "0.0.0"\n\n[[package]]\nname = "other"\nversion = "1.2.3"\n',
    'runtime/upstream.lock.json': JSON.stringify({ tag: 'v0.22.5', branch: 'hermess-desktop', commit: '882037eb8745b505db438217513c4c94f95c93c1' }),
    [`releases/${tag}.md`]: notes(tag),
  }
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, relative)
    mkdirSync(dirname(target), { recursive: true })
    if (Buffer.isBuffer(content)) writeFileSync(target, content)
    else writeFileSync(target, content, 'utf8')
  }
  return root
}

function run(root, action, selectedTag = tag) {
  return spawnSync(process.execPath, [join(root, 'scripts/release-version.mjs'), action, selectedTag], {
    cwd: root, encoding: 'utf8',
  })
}

test('stamps both Cargo records in an isolated checkout and verifies the tag', () => {
  const root = fixture()
  try {
    assert.equal(run(root, 'check').status, 0)
    assert.equal(run(root, 'stamp').status, 0)
    assert.equal(run(root, 'verify').status, 0)
    assert.match(readFileSync(join(root, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8'), /version = "0\.1\.8-rc\.3"/)
    const lock = readFileSync(join(root, 'apps/desktop/src-tauri/Cargo.lock'), 'utf8')
    assert.match(lock, /name = "hermess-agent-desktop"\nversion = "0\.1\.8-rc\.3"/)
    assert.match(lock, /name = "other"\nversion = "1\.2\.3"/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('rejects unsupported tags and a second hand-maintained version', () => {
  const root = fixture()
  try {
    assert.notEqual(run(root, 'check', 'v0.1.8-beta.1').status, 0)
    writeFileSync(join(root, 'package.json'), '{"version":"0.1.7"}\n', 'utf8')
    assert.notEqual(run(root, 'check').status, 0)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a stable tag stamps the release version after an unstamped checkout is rejected', () => {
  const root = fixture()
  try {
    const stable = 'v0.1.7'
    writeFileSync(join(root, `releases/${stable}.md`), notes(stable), 'utf8')
    assert.notEqual(run(root, 'verify', stable).status, 0)
    assert.equal(run(root, 'stamp', stable).status, 0)
    assert.equal(run(root, 'verify', stable).status, 0)
    assert.match(readFileSync(join(root, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8'), /version = "0\.1\.7"/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('rejects extra release sections and a fork version that differs from the lock', () => {
  const root = fixture()
  const path = join(root, `releases/${tag}.md`)
  try {
    writeFileSync(path, `${notes(tag)}\n## 验证与限制\n\n- 额外内容。\n`, 'utf8')
    assert.notEqual(run(root, 'check').status, 0)
    writeFileSync(path, notes(tag).replace('v0.22.5', 'v0.22.4'), 'utf8')
    assert.notEqual(run(root, 'check').status, 0)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
