import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const extensionViewUrl = new URL('../src/features/extensions/ExtensionsView.tsx', import.meta.url)
const profileOverviewUrl = new URL('../src/features/profiles/ProfileOverview.tsx', import.meta.url)
const profilePluginsUrl = new URL('../src/features/profiles/ProfileHermesPlugins.tsx', import.meta.url)

test('extension center exposes market categories only', async () => {
  const source = await readFile(extensionViewUrl, 'utf8')

  assert.match(source, /type Category = 'experts' \| 'skills' \| 'hermesPlugins' \| 'mcp'/)
  assert.doesNotMatch(source, /LocalSkills|LocalMcp|ProfileMcp/)
  assert.doesNotMatch(source, /category === 'installed'|category === 'local'/)
  assert.match(source, /已安装内容统一在对应 Profile 管理/)
})

test('local extension management stays in profile management', async () => {
  const [overview, plugins] = await Promise.all([
    readFile(profileOverviewUrl, 'utf8'),
    readFile(profilePluginsUrl, 'utf8'),
  ])

  assert.match(overview, /tab === 'skills'/)
  assert.match(overview, /tab === 'plugins'.*ProfileHermesPlugins/s)
  assert.match(overview, /tab === 'mcp'.*ProfileMcp/s)
  assert.match(plugins, /对应 Profile|此 Profile/)
  assert.match(plugins, /'enable' \| 'disable' \| 'update' \| 'remove' \| 'visibility'/)
})
