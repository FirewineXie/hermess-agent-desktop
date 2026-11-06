import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const profilesViewUrl = new URL('../src/features/profiles/ProfilesView.tsx', import.meta.url)
const profileOverviewUrl = new URL('../src/features/profiles/ProfileOverview.tsx', import.meta.url)
const useProfilesUrl = new URL('../src/features/profiles/useProfiles.ts', import.meta.url)

test('roster profiles remain selectable when the gateway does not serve them', async () => {
  const [view, controller] = await Promise.all([
    readFile(profilesViewUrl, 'utf8'),
    readFile(useProfilesUrl, 'utf8'),
  ])

  assert.match(view, /disabled=\{props\.profileBusy\}/)
  assert.doesNotMatch(view, /disabled=\{!served \|\| props\.profileBusy\}/)
  assert.match(controller, /roster\?\.profiles\.some\(profile => profile\.name === name\)/)
  assert.doesNotMatch(controller, /const served = roster\?\.gateways/)
  assert.match(controller, /const available = new Set\(latest\.profiles\.map\(profile => profile\.name\)\)/)
})

test('unserved profile details do not issue or enable runtime-dependent operations', async () => {
  const overview = await readFile(profileOverviewUrl, 'utf8')

  assert.match(overview, /if \(!served \|\| !profiles\) \{\s*return\s*\}/)
  assert.match(overview, /if \(!served \|\| !profiles \|\| pendingSkill\) return/)
  assert.match(overview, /disabled=\{!served \|\| pendingSkill !== null \|\| skill\.name === 'hermes-agent'\}/)
  assert.match(overview, /'settings', !served/)
  assert.match(overview, /'channels', !served/)
  assert.match(overview, /'usage', !served/)
})

test('viewed Profile and active runtime Profile remain separate', async () => {
  const [view, overview, controller] = await Promise.all([
    readFile(profilesViewUrl, 'utf8'),
    readFile(profileOverviewUrl, 'utf8'),
    readFile(useProfilesUrl, 'utf8'),
  ])

  assert.match(controller, /const activeProfile = roster\?\.selected \|\| null/)
  assert.match(controller, /await profiles\.activate\(name\)/)
  assert.match(controller, /if \(latest\.selected !== name\) throw new Error\('Active Profile change was not confirmed'\)/)
  assert.match(controller, /return \{ snapshot, activeProfile,/)
  assert.match(view, /activeProfile=\{props\.activeProfile\}/)
  assert.match(overview, /activeProfile === profile\.name/)
  assert.match(overview, /onActivateProfile\(profile\.name\)/)
})
