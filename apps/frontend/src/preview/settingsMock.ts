import type { AgentConfigSchema, CustomEndpoint, ModelOptions, MoaConfig, MemoryProviderConfig } from '@hermess/contracts'

type FieldSeed = [key: string, type: string, value: unknown, description: string, options?: unknown[]]

const seeds: FieldSeed[] = [
  ['model_context_length', 'number', 131072, '主模型可使用的上下文长度。'],
  ['agent.reasoning_effort', 'select', 'medium', '默认推理强度。', ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']],
  ['agent.service_tier', 'select', 'auto', '模型服务档位。', ['auto', 'default', 'flex', 'priority']],
  ['fallback_providers', 'list', [{ provider: 'openrouter', model: 'anthropic/claude-sonnet-4' }], '主模型不可用时按顺序尝试的回退模型。'],
  ['auxiliary.vision.provider', 'select', 'auto', '图像理解任务提供商。', ['auto', 'openai', 'openrouter']],
  ['auxiliary.vision.model', 'string', '', '图像理解任务模型。'],
  ['auxiliary.vision.reasoning_effort', 'select', '', '图像理解任务推理强度。', ['', 'low', 'medium', 'high']],
  ['auxiliary.vision.timeout', 'number', 120, '图像理解任务超时秒数。'],
  ['auxiliary.compression.provider', 'select', 'auto', '上下文压缩任务提供商。', ['auto', 'openai', 'openrouter']],
  ['auxiliary.compression.model', 'string', '', '上下文压缩任务模型。'],
  ['auxiliary.compression.timeout', 'number', 120, '上下文压缩超时秒数。'],
  ['delegation.model', 'string', '', '委派子 Agent 默认模型。'],
  ['delegation.provider', 'string', 'auto', '委派子 Agent 默认提供商。'],
  ['delegation.max_iterations', 'number', 8, '委派路由最大迭代次数。'],
  ['delegation.max_concurrent_children', 'number', 3, '允许并行运行的子 Agent 数量。'],
  ['delegation.child_timeout_seconds', 'number', 600, '单个子 Agent 超时秒数。'],
  ['delegation.reasoning_effort', 'select', 'medium', '委派任务默认推理强度。', ['low', 'medium', 'high', 'xhigh']],
  ['moa.enabled', 'boolean', false, '启用多模型聚合。'],
  ['moa.models', 'list', [], '参与聚合的有序模型列表。'],
  ['approvals.mode', 'select', 'ask', '工具执行审批模式。', ['ask', 'auto', 'deny']],
  ['approvals.timeout', 'number', 300, '审批请求超时秒数。'],
  ['approvals.mcp_reload_confirm', 'boolean', true, 'MCP 重载前要求确认。'],
  ['command_allowlist', 'list', ['git status', 'rg'], '可免重复审批的命令规则。'],
  ['security.redact_secrets', 'boolean', true, '在输出与日志中遮盖敏感信息。'],
  ['security.allow_private_urls', 'boolean', false, '允许工具访问私网 URL。'],
  ['checkpoints.enabled', 'boolean', true, '工具修改文件前创建检查点。'],
  ['checkpoints.max_snapshots', 'number', 20, '最多保留的检查点数量。'],
  ['memory.memory_enabled', 'boolean', true, '启用持久记忆。'],
  ['memory.user_profile_enabled', 'boolean', true, '启用用户画像。'],
  ['memory.memory_char_limit', 'number', 12000, '持久记忆字符上限。'],
  ['memory.user_char_limit', 'number', 8000, '用户画像字符上限。'],
  ['memory.provider', 'select', 'local', '记忆提供方。', ['local', 'mem0', 'honcho']],
  ['context.engine', 'select', 'native', '上下文管理引擎。', ['native', 'legacy']],
  ['compression.enabled', 'boolean', true, '达到阈值时压缩上下文。'],
  ['compression.threshold', 'number', 0.82, '触发上下文压缩的使用比例。'],
  ['compression.codex_gpt55_autoraise', 'boolean', true, '为支持的模型自动提高阈值。'],
  ['compression.target_ratio', 'number', 0.55, '压缩后的目标上下文比例。'],
  ['compression.protect_last_n', 'number', 8, '压缩时保留的最近消息数。'],
  ['voice.voice_chat_mode', 'select', 'chained', '语音对话路径。', ['chained', 'gpt_live']],
  ['voice.max_recording_seconds', 'number', 300, '单次录音上限秒数。'],
  ['voice.client_direct', 'boolean', false, '允许客户端直连语音服务。'],
  ['voice.gpt_live.voice', 'select', 'alloy', 'GPT Live 声音。', ['alloy', 'ash', 'ballad', 'coral', 'sage']],
  ['voice.gpt_live.instructions', 'string', '', '实时语音会话附加指令。'],
  ['stt.enabled', 'boolean', true, '启用语音转写。'],
  ['stt.echo_transcripts', 'boolean', true, '将转写文本放入输入框确认。'],
  ['stt.provider', 'select', 'openai', '语音转写提供商。', ['local', 'openai', 'groq', 'mistral', 'xai', 'deepinfra', 'elevenlabs']],
  ['stt.streaming', 'boolean', false, '启用流式转写。'],
  ['stt.local.model', 'string', 'small', '本地转写模型。'],
  ['stt.local.language', 'string', 'zh', '本地转写语言。'],
  ['stt.openai.model', 'string', 'gpt-4o-mini-transcribe', 'OpenAI 转写模型。'],
  ['stt.openai.streaming_model', 'string', 'gpt-4o-mini-transcribe', 'OpenAI 流式转写模型。'],
  ['stt.groq.model', 'string', 'whisper-large-v3-turbo', 'Groq 转写模型。'],
  ['stt.mistral.model', 'string', 'voxtral-mini-latest', 'Mistral 转写模型。'],
  ['stt.xai.model', 'string', 'grok-2-audio', 'xAI 转写模型。'],
  ['stt.deepinfra.model', 'string', 'openai/whisper-large-v3', 'DeepInfra 转写模型。'],
  ['stt.elevenlabs.model_id', 'string', 'scribe_v1', 'ElevenLabs 转写模型。'],
  ['stt.elevenlabs.language_code', 'string', 'zho', 'ElevenLabs ISO-639-3 语言代码。'],
  ['stt.elevenlabs.tag_audio_events', 'boolean', true, '标记非语音音频事件。'],
  ['stt.elevenlabs.diarize', 'boolean', false, '启用说话人分离。'],
  ['voice.auto_tts', 'boolean', false, '回复完成后自动播报。'],
  ['tts.provider', 'select', 'edge', '语音播报提供商。', ['edge', 'openai', 'elevenlabs', 'xai', 'minimax', 'mistral', 'gemini', 'neutts', 'kittentts', 'piper', 'deepinfra']],
  ['tts.edge.voice', 'string', 'zh-CN-XiaoxiaoNeural', 'Edge TTS 声音。'],
  ['tts.openai.model', 'string', 'gpt-4o-mini-tts', 'OpenAI TTS 模型。'],
  ['tts.openai.voice', 'string', 'alloy', 'OpenAI TTS 声音。'],
  ['tts.elevenlabs.voice_id', 'string', '', 'ElevenLabs 声音 ID。'],
  ['tts.elevenlabs.model_id', 'string', 'eleven_multilingual_v2', 'ElevenLabs TTS 模型。'],
  ['tts.xai.voice_id', 'string', 'Ara', 'xAI 声音 ID。'],
  ['tts.xai.language', 'string', 'zh', 'xAI 播报语言。'],
  ['tts.xai.speed', 'number', 1, 'xAI 播报速度。'],
  ['tts.xai.auto_speech_tags', 'boolean', false, '自动生成语音标签。'],
  ['tts.xai.optimize_streaming_latency', 'number', 0, 'xAI 流式延迟优化级别。'],
  ['tts.xai.sample_rate', 'number', 24000, 'xAI 音频采样率。'],
  ['tts.xai.bit_rate', 'number', 128000, 'xAI 音频比特率。'],
  ['tts.minimax.model', 'string', 'speech-02-hd', 'MiniMax TTS 模型。'],
  ['tts.minimax.voice_id', 'string', '', 'MiniMax 声音 ID。'],
  ['tts.mistral.model', 'string', 'voxtral-mini-latest', 'Mistral TTS 模型。'],
  ['tts.mistral.voice_id', 'string', '', 'Mistral 声音 ID。'],
  ['tts.gemini.model', 'string', 'gemini-2.5-flash-preview-tts', 'Gemini TTS 模型。'],
  ['tts.gemini.voice', 'string', 'Kore', 'Gemini 声音。'],
  ['tts.neutts.model', 'string', '', 'NeuTTS 模型路径。'],
  ['tts.neutts.device', 'string', 'auto', 'NeuTTS 运行设备。'],
  ['tts.kittentts.model', 'string', '', 'KittenTTS 模型。'],
  ['tts.kittentts.voice', 'string', '', 'KittenTTS 声音。'],
  ['tts.piper.voice', 'string', '', 'Piper 声音模型。'],
  ['tts.deepinfra.model', 'string', '', 'DeepInfra TTS 模型。'],
  ['tts.deepinfra.voice', 'string', '', 'DeepInfra 声音。'],
  ['updates.non_interactive_local_changes', 'select', 'stash', '自动更新遇到本地修改时的处理方式。', ['stash', 'discard']],
  ['agent.max_turns', 'number', 100, '单次运行最大回合数。'],
  ['agent.api_max_retries', 'number', 3, '模型 API 最大重试次数。'],
  ['agent.tool_use_enforcement', 'boolean', true, '要求模型按工具协议调用工具。'],
  ['toolsets', 'list', ['default'], '启用的工具集。'],
  ['terminal.backend', 'select', 'local', '终端执行后端。', ['local', 'docker', 'singularity', 'modal', 'daytona']],
  ['terminal.timeout', 'number', 300, '终端命令默认超时秒数。'],
  ['terminal.docker_image', 'string', '', 'Docker 终端镜像。'],
  ['terminal.singularity_image', 'string', '', 'Singularity 终端镜像。'],
  ['terminal.modal_image', 'string', '', 'Modal 终端镜像。'],
  ['terminal.daytona_image', 'string', '', 'Daytona 终端镜像。'],
  ['tool_output.max_bytes', 'number', 200000, '单次工具输出字节上限。'],
  ['tool_output.max_lines', 'number', 2000, '单次工具输出行数上限。'],
  ['tool_output.max_line_length', 'number', 4000, '单行工具输出长度上限。'],
]

function assign(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.')
  let cursor = target
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part]
    cursor = next && typeof next === 'object' && !Array.isArray(next) ? next as Record<string, unknown> : (cursor[part] = {}) as Record<string, unknown>
  }
  cursor[parts.at(-1)!] = value
}

export const previewSettingsSchema: AgentConfigSchema = {
  fields: Object.fromEntries(seeds.map(([key, type, , description, options]) => [key, { type, description, options }])),
  category_order: ['model', 'auxiliary', 'delegation', 'moa', 'memory', 'context', 'compression', 'approvals', 'security', 'checkpoints', 'voice', 'stt', 'tts', 'agent', 'terminal', 'tool_output'],
}

export const previewSettingsConfig: Record<string, unknown> = {}
for (const [key, , value] of seeds) assign(previewSettingsConfig, key, structuredClone(value))

export function setPreviewSetting(config: Record<string, unknown>, key: string, value: unknown) { assign(config, key, value) }

export const previewModelOptions: ModelOptions = {
  provider: 'openai', model: 'gpt-5.2', providers: [
    { slug: 'openai', name: 'OpenAI', authenticated: true, is_current: true, api_url: 'https://api.openai.com/v1', models: ['gpt-5.2', 'gpt-5-mini', 'gpt-4.1'] },
    { slug: 'anthropic', name: 'Anthropic', authenticated: true, api_url: 'https://api.anthropic.com', models: ['claude-sonnet-4-5', 'claude-opus-4-1'] },
    { slug: 'openrouter', name: 'OpenRouter', authenticated: true, api_url: 'https://openrouter.ai/api/v1', models: ['google/gemini-2.5-pro', 'qwen/qwen3-235b', 'deepseek/deepseek-r1'] },
  ],
}

export const previewEndpoints: CustomEndpoint[] = [
  { id: 'openrouter', name: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-pro', models: ['google/gemini-2.5-pro', 'qwen/qwen3-235b', 'deepseek/deepseek-r1'], source: 'custom_providers', is_current: false, discover_models: true },
]

export const previewMoaConfig: MoaConfig = {
  default_preset: 'balanced', active_preset: 'balanced', enabled: true,
  aggregator: { provider: 'openai', model: 'gpt-5.2' }, aggregator_temperature: 0.2,
  degraded_reference_policy: 'loud', reference_temperature: 0.4, reference_timeout: 120,
  reference_models: [{ provider: 'anthropic', model: 'claude-sonnet-4-5', enabled: true }, { provider: 'openrouter', model: 'google/gemini-2.5-pro', enabled: true }],
  presets: {
    balanced: {
      enabled: true, aggregator: { provider: 'openai', model: 'gpt-5.2' }, aggregator_temperature: 0.2,
      degraded_reference_policy: 'loud', reference_temperature: 0.4, reference_timeout: 120,
      reference_models: [{ provider: 'anthropic', model: 'claude-sonnet-4-5', enabled: true }, { provider: 'openrouter', model: 'google/gemini-2.5-pro', enabled: true }],
      fanout: 'user_turn',
    },
  },
}

export const previewDelegationRouting = {
  configured: 'default', blocked_reason: null as string | null,
  backends: [
    { name: 'default', label: '默认', description: '继承默认子 Agent 设置', available: true, reason: '', builtin: true },
    { name: 'model_map', label: '模型路由', description: '按任务选择命名模型', available: true, reason: '', builtin: false },
    { name: 'profile_routes', label: 'Profile 路由', description: '按任务选择目标 Profile', available: true, reason: '', builtin: false },
  ],
  model_map: { options: [] as Array<{ name: string; description: string; provider?: string; model: string }>, default: null as string | null },
  profile_routes: { profiles: [] as Array<{ name: string; description?: string }>, default: null as string | null },
  profiles: ['default', 'coder'],
}

export const previewMemoryProviderConfig: MemoryProviderConfig = {
  name: 'honcho', label: 'Honcho', docs_url: 'https://docs.honcho.dev', fields: [
    { key: 'workspace', label: 'Workspace', description: 'Honcho workspace name.', group: 'connection', inline: true, is_set: true, kind: 'text', options: [], placeholder: 'default', value: 'hermess-preview' },
    { key: 'api_key', label: 'API Key', description: 'Stored by the selected Profile runtime.', group: 'connection', inline: true, is_set: false, kind: 'secret', options: [], placeholder: '••••••••', value: '' },
    { key: 'environment', label: 'Environment', description: 'Remote environment.', group: 'connection', inline: false, is_set: true, kind: 'select', options: [{ value: 'production', label: 'Production', description: '' }, { value: 'sandbox', label: 'Sandbox', description: '' }], placeholder: '', value: 'sandbox' },
  ],
}
