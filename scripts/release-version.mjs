#!/usr/bin/env node
/** Validate a release identity and stamp only an isolated build checkout. */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const tagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$/

function fail(message) { throw new Error(message) }

function file(path) { return resolve(root, path) }

function manifestVersion() {
  const source = readFileSync(file('apps/desktop/src-tauri/Cargo.toml'), 'utf8')
  const section = source.slice(source.indexOf('[package]'), source.indexOf('\n[', 1))
  const matches = [...section.matchAll(/^version = "([^"]+)"$/gm)]
  if (!source.startsWith('[package]') || matches.length !== 1) {
    fail('Cargo.toml [package].version is missing or ambiguous')
  }
  return { source, version: matches[0][1] }
}

function lockVersion() {
  const source = readFileSync(file('apps/desktop/src-tauri/Cargo.lock'), 'utf8')
  const blocks = source.match(/\[\[package\]\]\r?\nname = "hermess-agent-desktop"\r?\nversion = "[^"]+"/g)
  if (!blocks || blocks.length !== 1) fail('Cargo.lock product package is missing or ambiguous')
  return { source, block: blocks[0], version: blocks[0].match(/version = "([^"]+)"$/)[1] }
}

function checkConfiguration() {
  for (const path of ['package.json', 'apps/desktop/package.json', 'apps/desktop/src-tauri/tauri.conf.json']) {
    if (Object.hasOwn(JSON.parse(readFileSync(file(path), 'utf8')), 'version')) {
      fail(`${path} must inherit the Cargo product version`)
    }
  }
}

function checkTag(tag) {
  if (!tagPattern.test(tag)) fail('tag must be vX.Y.Z or vX.Y.Z-rc.N (N >= 1)')
  const notes = readFileSync(file(`releases/${tag}.md`), 'utf8').trim()
  const upstream = JSON.parse(readFileSync(file('runtime/upstream.lock.json'), 'utf8'))
  const sections = notes.replaceAll('\r\n', '\n').split(/\n## /).map(section => section.trim())
  if (sections.length !== 4 || sections[0] !== `# Hermess Agent Desktop ${tag}` ||
      !sections[1].startsWith('新增功能\n\n') ||
      !sections[2].startsWith('修复问题\n\n') ||
      !sections[3].startsWith('Hermes fork 版本\n\n')) {
    fail(`release notes must contain only the three required sections: releases/${tag}.md`)
  }
  for (const section of sections.slice(1, 3)) {
    if (!section.split('\n').slice(2).every(line => line.startsWith('- ') && line.length > 2)) {
      fail(`release features and fixes must be bullet lists: releases/${tag}.md`)
    }
  }
  const forkLine = `Hermes fork 版本\n\n- 基于 Hermes Agent ${upstream.tag}；fork ${upstream.branch}（${upstream.commit}）。`
  if (sections[3] !== forkLine) fail(`release fork version differs from runtime/upstream.lock.json: releases/${tag}.md`)
  return tag.slice(1)
}

function replaceOne(source, oldVersion, nextVersion, path) {
  const needle = `version = "${oldVersion}"`
  if (!source.includes(needle)) fail(`${path} has no matching product version`)
  return source.replace(needle, `version = "${nextVersion}"`)
}

export function releaseVersion(action, tag) {
  const version = checkTag(tag)
  checkConfiguration()
  const manifest = manifestVersion()
  const lock = lockVersion()
  if (manifest.version !== lock.version) fail('Cargo.toml and Cargo.lock product versions differ')
  if ((action === 'check' || action === 'stamp') && manifest.version !== '0.0.0') {
    fail('release source must keep the 0.0.0 development version')
  }
  if (action === 'check') return console.log(`release source and notes ready for ${tag}`)
  if (action === 'verify') {
    if (manifest.version !== version) fail(`built version ${manifest.version} differs from ${tag}`)
    return console.log(`release build version matches ${tag}`)
  }
  if (action !== 'stamp') fail('action must be check, stamp, or verify')
  const manifestPath = file('apps/desktop/src-tauri/Cargo.toml')
  const lockPath = file('apps/desktop/src-tauri/Cargo.lock')
  writeFileSync(manifestPath, replaceOne(manifest.source, manifest.version, version, 'Cargo.toml'), 'utf8')
  writeFileSync(lockPath, lock.source.replace(lock.block,
    lock.block.replace(`version = "${lock.version}"`, `version = "${version}"`)), 'utf8')
  console.log(`stamped build checkout as ${version}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { releaseVersion(process.argv[2], process.argv[3]) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
