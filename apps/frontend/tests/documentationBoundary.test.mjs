import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const documentationUrl = new URL('../src/features/about/DocumentationView.tsx', import.meta.url)
const appUrl = new URL('../src/App.tsx', import.meta.url)
const settingsModelUrl = new URL('../src/features/settings/model.ts', import.meta.url)
const routeModelUrl = new URL('../src/features/dashboard-plugins/dashboardRouteModel.ts', import.meta.url)

test('documentation is a product page that opens the official site externally', async () => {
  const [documentation, app, settingsModel, routeModel] = await Promise.all([
    readFile(documentationUrl, 'utf8'),
    readFile(appUrl, 'utf8'),
    readFile(settingsModelUrl, 'utf8'),
    readFile(routeModelUrl, 'utf8'),
  ])

  assert.match(documentation, /links\.openDocumentation\(\)/)
  assert.doesNotMatch(documentation, /<iframe|dangerouslySetInnerHTML/)
  assert.match(settingsModel, /id: 'documentation'.*category: 'about'/)
  assert.match(routeModel, /settingsPage === 'documentation'.*return '\/docs'/)
  assert.match(routeModel, /\['\/docs', 'docs'\]/)
  assert.match(app, /settingsPage === 'documentation' && <DocumentationView \/>/)
})
