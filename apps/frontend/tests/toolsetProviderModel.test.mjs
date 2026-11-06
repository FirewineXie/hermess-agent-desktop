import assert from 'node:assert/strict'
import test from 'node:test'
import { visibleToolsetProviders } from '../src/features/profiles/toolsetProviderModel.ts'

test('toolset provider list excludes Nous account and managed entitlement entries', () => {
  const ordinary = { name: 'Brave', requires_nous_auth: false, managed_nous_feature: null }
  const account = { name: 'Portal Search', requires_nous_auth: true, managed_nous_feature: null }
  const entitlement = { name: 'Managed Extract', requires_nous_auth: false, managed_nous_feature: 'extract' }

  assert.deepEqual(visibleToolsetProviders([ordinary, account, entitlement]), [ordinary])
})

test('toolset provider list keeps legacy entries without account metadata', () => {
  const providers = [{ name: 'Local' }, { name: 'API key provider', requires_nous_auth: false }]
  assert.deepEqual(visibleToolsetProviders(providers), providers)
})
