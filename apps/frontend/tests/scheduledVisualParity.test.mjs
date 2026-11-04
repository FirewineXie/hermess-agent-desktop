import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const viewUrl = new URL('../src/features/scheduled-tasks/ScheduledTasksView.tsx', import.meta.url)
const blueprintsUrl = new URL('../src/features/scheduled-tasks/ScheduledBlueprints.tsx', import.meta.url)
const cssUrl = new URL('../src/features/scheduled-tasks/scheduled-tasks.css', import.meta.url)

test('scheduled tasks page exposes dashboard hierarchy and runtime overview', async () => {
  const source = await readFile(viewUrl, 'utf8')
  assert.match(source, /scheduled-page-heading/)
  assert.match(source, /scheduled-runtime-state/)
  assert.match(source, /scheduled-overview/)
  assert.match(source, /scheduled-jobs-toolbar/)
  assert.match(source, /scheduled-profile-filter/)
  assert.match(source, /scheduledJobState\(job\)/)
  assert.match(source, /state === 'paused'/)
  assert.match(source, /scheduled-status-badge/)
})

test('scheduled blueprints use styled controls and responsive cards', async () => {
  const [source, css] = await Promise.all([readFile(blueprintsUrl, 'utf8'), readFile(cssUrl, 'utf8')])
  assert.match(source, /scheduled-blueprints-controls/)
  assert.match(source, /scheduled-blueprint-category/)
  assert.match(source, /scheduled-blueprint-action/)
  assert.match(css, /\.scheduled-blueprint-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*?\.scheduled-list-row \{[^}]*min-width: 0;/)
  assert.match(css, /\.scheduled-list \{ overflow-x: hidden; \}/)
})
