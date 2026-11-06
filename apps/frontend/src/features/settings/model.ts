export type SettingsCategory = 'security' | 'advanced' | 'models' | 'management' | 'memory' | 'notifications' | 'browser' | 'runtime' | 'diagnostics' | 'update' | 'about' | 'desktop'
export type SettingsPage = 'security-approvals' | 'security-privacy' | 'security-checkpoints' | 'advanced-runtime' | 'advanced-tools' | 'advanced-terminal' | 'advanced-output' | 'advanced-config' | 'shell-hooks' | 'curator' | 'system-operations' | 'delegation' | 'device' | 'quick-input' | 'local-tools' | 'providers' | 'credential-pool' | 'main' | 'fallbacks' | 'auxiliary' | 'moa' | 'sessions' | 'pairing' | 'logs' | 'env-keys' | 'memory-persistent' | 'memory-context' | 'notification-alerts' | 'notification-sounds' | 'browser' | 'runtime' | 'runtime-status' | 'runtime-backup' | 'diagnostics' | 'update' | 'documentation' | 'about'

export const settingsPages: Array<{ id: SettingsPage; category: SettingsCategory; zh: string; en: string }> = [
  { id: 'security-approvals', category: 'security', zh: '审批与允许列表', en: 'Approvals & allowlist' },
  { id: 'security-privacy', category: 'security', zh: '隐私与安全', en: 'Privacy & security' },
  { id: 'security-checkpoints', category: 'security', zh: '检查点', en: 'Checkpoints' },
  { id: 'advanced-runtime', category: 'advanced', zh: '运行参数', en: 'Runtime parameters' },
  { id: 'advanced-tools', category: 'advanced', zh: '工具', en: 'Tools' },
  { id: 'advanced-terminal', category: 'advanced', zh: '终端', en: 'Terminal' },
  { id: 'advanced-output', category: 'advanced', zh: '输出限制', en: 'Output limits' },
  { id: 'advanced-config', category: 'advanced', zh: '完整配置', en: 'Full configuration' },
  { id: 'shell-hooks', category: 'advanced', zh: 'Shell Hooks', en: 'Shell hooks' },
  { id: 'curator', category: 'advanced', zh: '技能整理器', en: 'Skill curator' },
  { id: 'system-operations', category: 'advanced', zh: '系统维护', en: 'System maintenance' },
  { id: 'delegation', category: 'models', zh: '委派路由', en: 'Delegation routing' },
  { id: 'device', category: 'desktop', zh: '设备偏好', en: 'Device preferences' },
  { id: 'quick-input', category: 'desktop', zh: '快捷输入', en: 'Quick input' },
  { id: 'local-tools', category: 'desktop', zh: '工具与能力', en: 'Tools and capabilities' },
  { id: 'providers', category: 'models', zh: '提供商', en: 'Providers' },
  { id: 'credential-pool', category: 'models', zh: '凭据池', en: 'Credential pool' },
  { id: 'main', category: 'models', zh: '主模型', en: 'Main model' },
  { id: 'fallbacks', category: 'models', zh: '回退模型', en: 'Fallback models' },
  { id: 'auxiliary', category: 'models', zh: '辅助模型', en: 'Auxiliary models' },
  { id: 'moa', category: 'models', zh: 'MoA', en: 'MoA' },
  { id: 'sessions', category: 'management', zh: '会话管理', en: 'Sessions' },
  { id: 'pairing', category: 'management', zh: '配对管理', en: 'Pairing' },
  { id: 'logs', category: 'management', zh: '运行日志', en: 'Logs' },
  { id: 'env-keys', category: 'management', zh: '密钥管理', en: 'Keys' },
  { id: 'memory-persistent', category: 'memory', zh: '持久记忆', en: 'Persistent memory' },
  { id: 'memory-context', category: 'memory', zh: '上下文与压缩', en: 'Context & compression' },
  { id: 'notification-alerts', category: 'notifications', zh: '桌面提醒', en: 'Desktop alerts' },
  { id: 'notification-sounds', category: 'notifications', zh: '提示音', en: 'Sounds' },
  { id: 'browser', category: 'browser', zh: '浏览器控制', en: 'Browser control' },
  { id: 'runtime', category: 'runtime', zh: '存储设置', en: 'Storage settings' },
  { id: 'runtime-status', category: 'runtime', zh: '主机状态', en: 'Host status' },
  { id: 'runtime-backup', category: 'runtime', zh: '完整备份', en: 'Full backup' },
  { id: 'diagnostics', category: 'diagnostics', zh: '开发者诊断', en: 'Developer diagnostics' },
  { id: 'update', category: 'update', zh: '软件更新', en: 'Software updates' },
  { id: 'documentation', category: 'about', zh: '官方文档', en: 'Documentation' },
  { id: 'about', category: 'about', zh: '关于', en: 'About' },
]

export const settingsCategories: Array<{
  id: SettingsCategory
  page: SettingsPage
  zh: string
  en: string
  descriptionZh: string
  descriptionEn: string
  profileScoped: boolean
}> = [
  { id: 'models', page: 'providers', zh: '模型', en: 'Models', descriptionZh: '当前 Profile 的提供商与模型配置', descriptionEn: 'Providers and models for the selected Profile', profileScoped: true },
  { id: 'management', page: 'sessions', zh: 'Profile 管理', en: 'Profile management', descriptionZh: '当前 Profile 的会话、访问配对、运行日志与密钥', descriptionEn: 'Sessions, pairing, runtime logs, and keys for the selected Profile', profileScoped: true },
  { id: 'memory', page: 'memory-persistent', zh: '记忆与上下文', en: 'Memory & context', descriptionZh: '当前 Profile 的持久记忆、上下文和压缩配置', descriptionEn: 'Memory, context, and compression for the selected Profile', profileScoped: true },
  { id: 'notifications', page: 'notification-alerts', zh: '通知', en: 'Notifications', descriptionZh: '本机原生通知与完成提示音', descriptionEn: 'Native notifications and completion sounds on this device', profileScoped: false },
  { id: 'browser', page: 'browser', zh: '浏览器', en: 'Browser', descriptionZh: '当前 Profile 的浏览器控制方式', descriptionEn: 'Browser control for the selected Profile', profileScoped: true },
  { id: 'security', page: 'security-approvals', zh: '安全', en: 'Security', descriptionZh: '当前 Profile 的审批、隐私与检查点', descriptionEn: 'Approvals, privacy, and checkpoints for this Profile', profileScoped: true },
  { id: 'advanced', page: 'advanced-runtime', zh: '高级', en: 'Advanced', descriptionZh: '当前 Profile 的运行参数与完整配置', descriptionEn: 'Runtime parameters and full configuration for this Profile', profileScoped: true },
  { id: 'desktop', page: 'device', zh: '桌面', en: 'Desktop', descriptionZh: '设备偏好、全局快捷输入与本机工具', descriptionEn: 'Device preferences, global quick input, and local tools', profileScoped: false },
  { id: 'runtime', page: 'runtime', zh: '运行时与存储', en: 'Runtime & storage', descriptionZh: '', descriptionEn: '', profileScoped: false },
  { id: 'diagnostics', page: 'diagnostics', zh: '开发者诊断', en: 'Developer diagnostics', descriptionZh: '', descriptionEn: '', profileScoped: false },
  { id: 'update', page: 'update', zh: '软件更新', en: 'Software updates', descriptionZh: '', descriptionEn: '', profileScoped: false },
  { id: 'about', page: 'about', zh: '关于', en: 'About', descriptionZh: '', descriptionEn: '', profileScoped: false },
]
