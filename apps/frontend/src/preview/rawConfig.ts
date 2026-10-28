import { parseDocument, stringify } from 'yaml'

const MAX_RAW_BYTES = 256 * 1024

export function previewRawYaml(config: Record<string, unknown>): string {
  return stringify(config)
}

export function savePreviewRawYaml(config: Record<string, unknown>, yamlText: string, expectedYaml: string): void {
  const encoder = new TextEncoder()
  if (encoder.encode(yamlText).length > MAX_RAW_BYTES || encoder.encode(expectedYaml).length > MAX_RAW_BYTES) {
    throw new Error('PREVIEW_ONLY: YAML 内容超过 256 KiB。')
  }
  if (previewRawYaml(config) !== expectedYaml) {
    throw new Error('PREVIEW_ONLY: 配置已变化，请重新读取后再保存。')
  }
  const document = parseDocument(yamlText, { uniqueKeys: true })
  if (document.errors.length) throw new Error(`PREVIEW_ONLY: ${document.errors[0].message}`)
  const parsed: unknown = document.toJS()
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('PREVIEW_ONLY: 根配置必须是 YAML 对象。')
  }
  for (const key of Object.keys(config)) delete config[key]
  Object.assign(config, parsed)
}
