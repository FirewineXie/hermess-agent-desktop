import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const sourceRoot = resolve(root, 'upstream/hermes-agent/web/src/i18n')
const outputRoot = resolve(root, 'apps/frontend/src/features/dashboard-plugins/generated')

const locales = [
  ['en', 'en', 'en'], ['zh', 'zh', 'zh'], ['zh-hant', 'zh-hant', 'zhHant'], ['ja', 'ja', 'ja'],
  ['de', 'de', 'de'], ['es', 'es', 'es'], ['fr', 'fr', 'fr'], ['tr', 'tr', 'tr'], ['uk', 'uk', 'uk'],
  ['af', 'af', 'af'], ['ko', 'ko', 'ko'], ['it', 'it', 'it'], ['ga', 'ga', 'ga'], ['pt', 'pt', 'pt'],
  ['ru', 'ru', 'ru'], ['hu', 'hu', 'hu'], ['ar', 'ar', 'ar'],
]

function renderTranslationModule(source, exportName) {
  const partial = source.includes('defineLocale(')
  const body = source
    .replace(/^import[^\n]*\n/, partial ? "import { defineDashboardLocale } from '../dashboardLocaleDefinition.ts'\n" : '')
    .replace(
      partial ? `export const ${exportName} = defineLocale(` : `export const ${exportName}: Translations =`,
      partial ? 'const translations = defineDashboardLocale(' : 'const translations =',
    )
  return `${body.trimEnd()}\n\nexport default translations\n`
}

async function generate(locale, sourceName, exportName) {
  const source = await readFile(resolve(sourceRoot, `${sourceName}.ts`), 'utf8')
  const output = renderTranslationModule(source, exportName)
  const target = resolve(outputRoot, `dashboard.${locale}.ts`)
  if (process.argv.includes('--check')) {
    const current = await readFile(target, 'utf8').catch(() => '')
    if (current !== output) throw new Error(`${target} is stale; regenerate it from the locked Dashboard translations`)
    return
  }
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, output, 'utf8')
}

for (const locale of locales) await generate(...locale)
