type AchievementRecord = Record<string, unknown>

export const achievementZh = {
  hero: {
    kicker: 'Agent 成就分', title: 'Hermes 成就',
    subtitle: '根据真实会话历史获得的 Hermes 徽章。未完成的成就显示为“已发现”，秘密成就在出现匹配行为前保持隐藏。',
    scan_subtitle: '正在扫描 Hermes 会话历史。历史较多时，首次扫描可能需要一些时间。',
  },
  actions: { rescan: '重新扫描' },
  stats: {
    unlocked: '已解锁', unlocked_hint: '已经获得的徽章', discovered: '已发现', discovered_hint: '已知但尚未获得',
    secrets: '秘密', secrets_hint: '出现首次信号前保持隐藏', highest_tier: '最高等级',
    highest_tier_hint: '铜牌 → 银牌 → 金牌 → 钻石 → 奥林匹斯', latest: '最新成就', latest_hint_empty: '继续使用 Hermes', none_yet: '暂无',
  },
  state: { unlocked: '已解锁', discovered: '已发现', secret: '秘密' },
  tier: { target: '目标 {tier}', hidden: '隐藏', complete: '已完成', objective: '目标' },
  progress: { hidden: '隐藏' },
  scan: {
    building_headline: '正在构建成就档案…', building_detail: '正在读取会话、工具调用、模型元数据和解锁状态。',
    starting_headline: '正在开始成就扫描…',
    progress_detail: '已扫描 {scanned} / {total} 个会话 · {pct}%。随着更多历史载入，徽章会陆续解锁。',
    idle_detail: '正在读取会话、工具调用、模型元数据和解锁状态。徽章解锁后会显示在这里。',
  },
  guide: {
    tiers_header: '等级', secret_header: '秘密成就',
    secret_body: '秘密成就会隐藏确切触发条件。Hermes 检测到相关信号后，卡片会变为“已发现”并显示要求。',
    scan_status_header: '扫描状态', scan_status_body: 'Hermes 正在扫描本地历史，完成后卡片会自动出现。',
    what_scanned_header: '扫描内容', what_scanned_body: '会话、工具调用、模型元数据、错误、成就和本地解锁状态。',
  },
  card: {
    share_title: '分享此成就', share_label: '分享 {name}', share_text: '分享', how_to_reveal: '如何揭示',
    what_counts: '达成条件', evidence_label: '证据', evidence_session_fallback: '会话', no_evidence: '暂无证据',
  },
  latest: { header: '最近解锁' },
  empty: { no_secrets_header: '本次扫描已没有隐藏的秘密成就。', no_secrets_body: '秘密成就通常来自异常失败或高级使用模式，请继续探索 Hermes 的不同能力。' },
  filters: { all_categories: '全部', visibility_all: '全部', visibility_unlocked: '已解锁', visibility_discovered: '已发现', visibility_secret: '秘密' },
  share: {
    dialog_label: '分享成就', header: '分享：{name}', close: '关闭', rendering: '渲染中…', card_alt: '{name} 分享卡片',
    error_generic: '发生错误。', x_title: '在 X 中打开预填内容', x_button: '分享到 X', copy_title: '复制图片',
    copy_button: '复制图片', copied: '已复制 ✓', download_button: '下载 PNG',
    hint: '分享到 X 会打开预填内容。可以先复制图片并粘贴到帖子中，或下载 PNG 后在其他位置使用。',
    clipboard_unsupported: '当前浏览器不支持复制剪贴板图片，请改用下载。',
    tweet_text: '刚刚在 Hermes Agent 中解锁了 {tier_part}“{name}” ☤',
  },
}

const categories: Record<string, string> = {
  'Agent Autonomy': 'Agent 自主性', 'Debugging Chaos': '调试风暴', 'Vibe Coding': '氛围编程',
  'Hermes Native': 'Hermes 原生能力', 'Research/Web': '研究与网络', 'Tool Mastery': '工具精通',
  'Model Lore': '模型探索', Lifestyle: '使用习惯',
}

const achievementText: Record<string, [string, string]> = {
  let_him_cook: ['放手执行', '让 Hermes 在一次会话中完成一条真正自主的长工具链。'],
  autonomous_avalanche: ['自主雪崩', '在多个会话中累计大量 Hermes 工具调用。'],
  toolchain_maxxer: ['工具链全能手', '在一次会话中使用种类丰富的 Hermes 工具。'],
  full_send: ['火力全开', '在一次真实任务中同时使用终端、文件和网页或浏览器。'],
  subagent_commander: ['子 Agent 指挥官', '协调委派给其他 Agent 的工作。'],
  background_process_enjoyer: ['后台进程玩家', '启动或控制足够多的长时间运行进程。'],
  cron_necromancer: ['定时任务召唤师', '创建并运行大量自主定时任务。'],
  red_text_connoisseur: ['红字鉴赏家', '经历足够多的错误，练就识别红色报错的眼力。'],
  stack_trace_sommelier: ['堆栈追踪品鉴师', '反复分析异常和堆栈追踪。'],
  actually_read_the_logs: ['真的会看日志', '反复检查日志，而不是靠猜。'],
  port_3000_taken: ['3000 端口又被占了', '多次遇到开发服务器端口冲突。'],
  permission_denied_any_percent: ['权限拒绝速通', '多次撞上权限限制。'],
  dependency_hell_tourist: ['依赖地狱游客', '包安装失败之后仍然把事情继续做完。'],
  the_fix_was_restarting: ['重启解决一切', '在错误集中出现后通过重启或重新加载恢复。'],
  forgot_the_env_var: ['忘了环境变量', '因为缺少环境变量导致鉴权或配置失败。'],
  yaml_colon_incident: ['YAML 冒号事故', '被配置语法问题反复绊倒。'],
  docker_name_collision: ['Docker 名称冲突', '容器名称已经存在——当然又存在。'],
  supposed_to_be_quick: ['本来应该很快', '一个小需求最终变成了一场远征。'],
  one_more_small_change: ['再改一个小地方', '一次会话里的文件修改多到不能再称为小改动。'],
  vibe_architect: ['氛围架构师', '在一次项目会话中触及广泛的代码区域。'],
  pixel_goblin: ['像素精灵', '持续进行前端、CSS、SVG 或视觉调优。'],
  ship_first_ask_later: ['先发布再说', '在一条高强度工具链之后继续完成 Git 操作。'],
  css_exorcist: ['CSS 驱魔师', '反复清除界面中的样式问题。'],
  one_character_fix: ['一个字符的修复', '在一堆错误之后完成一个极小修复。痛苦，但漂亮。'],
  skillsmith: ['Skill 锻造师', '频繁使用 Hermes Skill，留下足够多的操作痕迹。'],
  skill_issue_skill_created: ['有问题？做个 Skill', '创建或修改可复用流程，避免重复劳动。'],
  memory_keeper: ['记忆守护者', '通过记忆工具持久保存重要知识。'],
  memory_palace: ['记忆宫殿', '建立大量可靠的长期记忆记录。'],
  context_dragon: ['上下文巨龙', '频繁处理压缩、超长上下文或 Token 压力。'],
  gateway_dweller: ['Gateway 常驻者', '长期使用连接 Gateway 的 Hermes 工作流。'],
  plugin_goblin: ['插件精灵', '频繁使用或开发插件。'],
  rollback_wizard: ['回滚巫师', '使用回滚或检查点恢复能力。'],
  rabbit_hole_certified: ['深挖认证', '搜索或提取大量网页内容，完成深入研究。'],
  citation_goblin: ['引用精灵', '提取大量网页，像一位微型图书管理员。'],
  docs_archaeologist: ['文档考古学家', '反复深入文档和说明材料。'],
  browser_possession: ['浏览器附身', '反复通过自动化控制浏览器。'],
  terminal_goblin: ['终端精灵', '在命令行环境中投入大量时间。'],
  patch_wizard: ['补丁巫师', '通过精确补丁修改大量文件。'],
  file_archaeologist: ['文件考古学家', '通过读取和搜索深入探索文件系统。'],
  image_whisperer: ['图像低语者', '频繁使用图像生成或视觉工具。'],
  voice_of_the_machine: ['机器之声', '反复使用文本转语音或语音工具。'],
  model_hopper: ['模型跳跃者', '频繁切换或检查模型和提供商。'],
  openrouter_enjoyer: ['OpenRouter 玩家', '反复通过 OpenRouter 路由模型任务。'],
  codex_conjurer: ['Codex 召唤师', '频繁调用 Codex 风格的编码协助。'],
  multi_model_mage: ['多模型法师', '在 Hermes 历史中使用大量不同模型。'],
  five_model_flight: ['五模型巡航', '至少尝试五种不同的大语言模型。'],
  provider_polyglot: ['提供商多面手', '在 Hermes 历史中使用多个模型提供商。'],
  model_sommelier: ['模型品鉴师', '体验足够多的模型与提供商并形成偏好。'],
  claude_confidant: ['Claude 知己', '反复在工作流中使用 Claude 系列模型。'],
  gemini_cartographer: ['Gemini 绘图师', '深入探索 Gemini 相关工作流。'],
  open_weights_pilgrim: ['开放权重朝圣者', '通过 Hermes 与本地或开放权重模型进行真实对话。'],
  toolset_cartographer: ['工具集绘图师', '有意识地配置和使用 Hermes 工具集。'],
  config_surgeon: ['配置外科医生', '熟练修改配置文件、清单、环境变量和 Dashboard 设置。'],
  rebase_acrobat: ['Rebase 杂技师', '处理变基、冲突、合并、拉取和推送等 Git 历史操作。'],
  test_suite_tamer: ['测试套件驯服者', '运行大量验证命令，让绿色结果成为习惯。'],
  screenshot_hunter: ['截图猎人', '捕获、检查并打磨视觉证据，而不是只声称功能可用。'],
  marathon_operator: ['马拉松操作员', '累计大量 Hermes 会话。'],
  weekend_warrior: ['周末战士', '经常在周末运行 Hermes。'],
  night_shift_operator: ['夜班操作员', '反复在深夜或凌晨运行会话。'],
  cache_hit_appreciator: ['缓存命中鉴赏家', '观察或受益于提示词缓存行为。'],
}

const metricLabels: Record<string, string> = {
  max_tool_calls_in_session: '单次会话工具调用数', max_distinct_tools_in_session: '单次会话使用的不同工具数',
  max_terminal_calls_in_session: '单次会话终端调用数', max_file_tool_calls_in_session: '单次会话文件、搜索和补丁调用数',
  max_web_browser_calls_in_session: '单次会话网页和浏览器调用数', max_messages_in_session: '单次会话消息数',
  max_files_touched_in_session: '单次会话涉及的文件数', total_delegate_calls: '累计任务委派次数',
  total_process_calls: '累计后台进程操作次数', total_cron_calls: '累计定时任务操作次数', total_errors: '观察到的错误或失败数',
  traceback_events: '异常或堆栈追踪数', log_read_events: '日志检查次数', port_conflict_events: '端口冲突次数',
  permission_denied_events: '权限拒绝次数', install_error_events: '依赖安装失败次数', install_success_events: '依赖安装成功次数',
  restart_after_error_events: '错误后的重启或重载次数', env_var_error_events: '环境变量缺失事件数', yaml_error_events: 'YAML 或配置解析错误数',
  docker_conflict_events: 'Docker 或容器名称冲突数', frontend_activity_events: '前端、CSS、SVG 或 React 活动数',
  css_activity_events: 'CSS 和样式活动数', git_events: 'Git 工作流操作数', tiny_patch_after_errors_events: '错误后的微小修复数',
  skill_events: 'Skill 使用事件数', skill_manage_events: 'Skill 管理操作数', memory_events: '记忆工具事件数', memory_write_events: '长期记忆写入数',
  context_events: '上下文、压缩或 Token 压力事件数', gateway_events: 'Gateway 或平台活动数', plugin_events: '插件活动数',
  rollback_events: '回滚或检查点恢复数', docs_activity_events: '文档活动数', model_events: '模型或提供商活动数',
  openrouter_events: 'OpenRouter 活动数', codex_events: 'Codex 活动数', cache_events: '缓存命中活动数', total_web_calls: '累计网页调用数',
  total_web_extract_calls: '累计网页提取数', browser_calls: '累计浏览器自动化调用数', total_tool_calls: '累计 Hermes 工具调用数',
  total_terminal_calls: '累计终端调用数', total_patch_calls: '累计补丁操作数', total_file_reads_searches: '累计文件读取和搜索数',
  image_vision_calls: '图像或视觉工具调用数', tts_calls: '语音工具调用数', distinct_model_count: '不同模型数量',
  distinct_provider_count: '不同模型提供商数量', claude_events: 'Claude 模型活动数', gemini_events: 'Gemini 模型活动数',
  local_model_chat_sessions: '本地或开放权重模型会话数', toolset_events: '工具集活动数', config_events: '配置活动数',
  git_history_events: 'Git 历史操作数', test_events: '测试或检查命令数', screenshot_events: '截图或视觉检查数',
  session_count: 'Hermes 会话数', weekend_sessions: '周末会话数', night_sessions: '深夜会话数',
}

const tierLabels: Record<string, string> = { Copper: '铜牌', Silver: '银牌', Gold: '金牌', Diamond: '钻石', Olympian: '奥林匹斯' }

function criteria(item: AchievementRecord) {
  if (item.state === 'secret') return '秘密成就：Hermes 检测到首次相关行为之前，具体要求保持隐藏。'
  const tiers = Array.isArray(item.tiers) ? item.tiers as AchievementRecord[] : []
  if (typeof item.threshold_metric === 'string' && tiers.length) {
    const ladder = tiers.map(tier => `${tierLabels[String(tier.name)] || String(tier.name)} ${tier.threshold}`).join('、')
    return `要求：${metricLabels[item.threshold_metric] || item.threshold_metric}。等级门槛：${ladder}。`
  }
  const requirements = Array.isArray(item.requirements) ? item.requirements as AchievementRecord[] : []
  if (requirements.length) return `要求：${requirements.map(requirement => `${metricLabels[String(requirement.metric)] || String(requirement.metric)} ≥ ${requirement.gte}`).join('；')}。`
  return '要求：完成对应的 Hermes 使用行为。'
}

function localizeAchievement(item: AchievementRecord): AchievementRecord {
  const translated = typeof item.id === 'string' ? achievementText[item.id] : undefined
  return {
    ...item,
    name: item.state === 'secret' ? '???' : translated?.[0] || item.name,
    description: item.state === 'secret' ? '秘密成就：在 Hermes 检测到首次相关行为之前保持隐藏。' : translated?.[1] || item.description,
    category: categories[String(item.category)] || item.category,
    criteria: criteria(item),
  }
}

export function localizeAchievementPayload(path: string, value: unknown, language: 'zh-CN' | 'en-US') {
  if (language !== 'zh-CN' || !path.includes('/api/plugins/hermes-achievements')) return value
  if (Array.isArray(value)) return value.map(item => item && typeof item === 'object' ? localizeAchievement(item as AchievementRecord) : item)
  if (!value || typeof value !== 'object') return value
  const result = value as AchievementRecord
  const achievements = Array.isArray(result.achievements)
    ? (result.achievements as AchievementRecord[]).map(localizeAchievement)
    : result.achievements
  return { ...result, achievements }
}

export function localizeDashboardPluginLabel(name: string, label: string, language: 'zh-CN' | 'en-US') {
  return language === 'zh-CN' && name === 'hermes-achievements' ? '成就' : label
}
