import assert from 'node:assert/strict'
import test from 'node:test'
import { dashboardPluginI18n } from '../src/features/dashboard-plugins/dashboardI18n.ts'

test('dashboard plugin i18n exposes the complete locked translation tree', () => {
  const english = dashboardPluginI18n('en', () => {})
  const chinese = dashboardPluginI18n('zh', () => {})

  assert.equal(english.locale, 'en')
  assert.equal(english.t.common.save, 'Save')
  assert.equal(english.t.app.nav.sessions, 'Sessions')
  assert.equal(typeof english.t.achievements.hero.title, 'string')
  assert.match(english.t.pluginsPage.updateConsentBody('example', 'abc123'), /example \(abc123\)/)
  assert.equal(chinese.locale, 'zh')
  assert.equal(chinese.t.common.save, '保存')
  assert.equal(chinese.t.app.nav.sessions, '会话')
  assert.equal(typeof chinese.t.achievements.hero.title, 'string')
})

test('dashboard plugin exposes every locked locale and preserves partial-locale fallback', () => {
  const locales = ['en', 'zh', 'zh-hant', 'ja', 'de', 'es', 'fr', 'tr', 'uk', 'af', 'ko', 'it', 'ga', 'pt', 'ru', 'hu', 'ar']
  for (const locale of locales) {
    const i18n = dashboardPluginI18n(locale, () => {})
    assert.equal(i18n.locale, locale)
    assert.equal(typeof i18n.t.common.save, 'string')
    assert.equal(typeof i18n.t.app.nav.sessions, 'string')
  }
  const arabic = dashboardPluginI18n('ar', () => {})
  assert.equal(typeof arabic.t.pluginsPage.updateConsentBody, 'function')
  assert.equal(typeof arabic.t.pluginsPage.updateConsentBody('example', 'abc123'), 'string')
})

test('dashboard plugin setLocale preserves every locked locale value', () => {
  const changes = []
  const i18n = dashboardPluginI18n('en', locale => changes.push(locale))
  i18n.setLocale('zh')
  i18n.setLocale('fr')
  i18n.setLocale('ar')
  assert.deepEqual(changes, ['zh', 'fr', 'ar'])
})
