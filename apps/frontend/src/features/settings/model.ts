export type SettingsCategory = 'model' | 'gateway' | 'notifications' | 'memory' | 'security' | 'voice' | 'advanced' | 'about'

export type SettingsLocation = {
  category: SettingsCategory
  subpage: string
}

export type SettingsCategoryDefinition = {
  id: SettingsCategory
  label: { 'zh-CN': string; 'en-US': string }
  description: { 'zh-CN': string; 'en-US': string }
  subpages: Array<{ id: string; label: { 'zh-CN': string; 'en-US': string } }>
}

const label = (zh: string, en: string) => ({ 'zh-CN': zh, 'en-US': en })

export const SETTINGS_CATEGORIES: SettingsCategoryDefinition[] = [
  { id: 'model', label: label('模型', 'Models'), description: label('Profile 级提供商、模型分配与路由', 'Profile-scoped providers, assignments, and routing'), subpages: [
    { id: 'providers', label: label('提供商', 'Providers') },
    { id: 'main', label: label('主模型', 'Main model') },
    { id: 'fallbacks', label: label('回退模型', 'Fallback models') },
    { id: 'auxiliary', label: label('辅助模型', 'Auxiliary models') },
    { id: 'delegation', label: label('委派', 'Delegation') },
    { id: 'moa', label: label('MoA', 'MoA') },
  ] },
  { id: 'gateway', label: label('网关', 'Gateway'), description: label('本地运行时与存储', 'Local runtime and storage'), subpages: [
    { id: 'runtime', label: label('本地运行时与存储', 'Local runtime & storage') },
  ] },
  { id: 'notifications', label: label('通知', 'Notifications'), description: label('本机提醒、声音与定位行为', 'Device alerts, sounds, and navigation behavior'), subpages: [
    { id: 'alerts', label: label('桌面提醒', 'Desktop alerts') },
    { id: 'sounds', label: label('声音', 'Sounds') },
  ] },
  { id: 'memory', label: label('记忆与上下文', 'Memory & context'), description: label('Profile 级持久记忆、上下文和压缩', 'Profile-scoped persistent memory, context, and compression'), subpages: [
    { id: 'persistent', label: label('持久记忆', 'Persistent memory') },
    { id: 'context', label: label('上下文与压缩', 'Context & compression') },
  ] },
  { id: 'security', label: label('安全', 'Security'), description: label('Profile 级审批、隐私与检查点规则', 'Profile-scoped approvals, privacy, and checkpoints'), subpages: [
    { id: 'approvals', label: label('审批', 'Approvals') },
    { id: 'privacy', label: label('隐私', 'Privacy') },
    { id: 'checkpoints', label: label('检查点', 'Checkpoints') },
  ] },
  { id: 'voice', label: label('语音', 'Voice'), description: label('转写和播报的 Profile 配置', 'Profile settings for transcription and speech'), subpages: [
    { id: 'transcription', label: label('转写', 'Transcription') },
    { id: 'speech', label: label('播报', 'Speech') },
  ] },
  { id: 'advanced', label: label('高级', 'Advanced'), description: label('运行参数、工具、终端与原始配置', 'Runtime, tools, terminal, and raw configuration'), subpages: [
    { id: 'desktop', label: label('桌面与启动', 'Desktop & startup') },
    { id: 'runtime', label: label('运行参数', 'Runtime') },
    { id: 'tools', label: label('工具', 'Tools') },
    { id: 'terminal', label: label('终端', 'Terminal') },
    { id: 'output', label: label('输出限制', 'Output limits') },
    { id: 'raw', label: label('原始 Agent 配置', 'Raw agent config') },
  ] },
  { id: 'about', label: label('关于', 'About'), description: label('版本、更新、许可和反馈', 'Version, updates, licenses, and feedback'), subpages: [
    { id: 'overview', label: label('关于 Hermess', 'About Hermess') },
    { id: 'updates', label: label('软件更新', 'Updates') },
  ] },
]

export function defaultSettingsLocation(category: SettingsCategory = 'model'): SettingsLocation {
  const definition = SETTINGS_CATEGORIES.find(item => item.id === category) || SETTINGS_CATEGORIES[0]
  return { category: definition.id, subpage: definition.subpages[0].id }
}

export function normalizeSettingsLocation(location: SettingsLocation): SettingsLocation {
  const definition = SETTINGS_CATEGORIES.find(item => item.id === location.category) || SETTINGS_CATEGORIES[0]
  return definition.subpages.some(item => item.id === location.subpage)
    ? location
    : { category: definition.id, subpage: definition.subpages[0].id }
}
