# WorkBuddy 专家包导入 Profile 落地方案

状态：首版代码已实现，Windows 解析与构建验证通过；原生窗口操作、真实 Gateway 导入及 macOS 实机尚未验收。

## 1. 目标与边界

在「扩展中心 → 专家」的「创建自定义专家」旁增加「导入专家包」。用户选择一个本地 WorkBuddy 专家包目录，预览后创建**一个**独立的 Hermes Profile。一个 `expertType: "team"` 包仍是一个 Profile；主理人与成员是包内角色，不额外创建多个 Profile。

首版交付四项可核对结果：Profile 创建成功；主理人的身份与职责写入该 Profile 的 `SOUL.md`；清单列出的 Skill 连同脚本、参考资料和素材完整保存并被 Hermes 发现；角色原文与包元数据保存在 Profile 内供查看。**文件导入成功不等于 WorkBuddy 团队调度、外部 API、脚本依赖或多模态模型已经可用。**

导入只写本产品的数据根，不读取或修改用户另行安装的 Hermes，不修改锁定的 `upstream/hermes-agent` fork，不在导入时运行来源脚本、安装依赖或调用外部服务。

## 2. 当前事实与样本

- 两个验收样本 `gzh-publish-team/`、`ai-content-creator-team/` 均有 `.codebuddy-plugin/plugin.json`，其中的 `agents`、`skills`、`agentName`、`teamInfo` 可用于确定清单与主理人。README 是介绍，不是主理人的提示词；主理人文件同样在 `agents/` 内。
- 公众号包有 5 份角色文件和 9 个 Skill，包含 Python 脚本、排版模板和包根目录的 `assets/`；内容创作包有 7 份角色文件和 1 个知识型 Skill。两个清单都没有 MCP 定义，因此预览应显示「MCP：0」，不可把调用 HTTP 的 Python 脚本登记为 MCP。
- 当前「创建自定义专家」只接受名称；内置预设额外传 `personalityName`、`personalityPrompt`、Skill 名和 MCP 名。`personalityPrompt` 的 Rust 校验上限为 4096 字节，不能直接用它提交完整主理人文件。当前「创建 Skill」只提交 `SKILL.md` 文本，也不能承载脚本与素材目录。
- 锁定 Hermes 会递归发现 Profile `skills/` 下的 `SKILL.md`。Profile 创建时会生成默认 `SOUL.md` 和空 `.env`；`memories/USER.md`、`memories/MEMORY.md` 属于使用者资料和持续记忆。两个样本均未提供这三种个人文件。

实现时以当前代码和锁文件复核上述事实；样本目录是本机验收输入，不写进程序常量或测试样本文件。

## 3. 文件映射

| 来源 | 目标 | 处理规则 |
| --- | --- | --- |
| `plugin.json` 的 `name` | Profile 标识的默认建议值 | 遵守现有 Profile 名称校验；冲突时由用户改名，不覆盖现有 Profile。 |
| `displayName`、`description`、`avatar` | 导入记录与专家详情 | 保存来源值；头像是否显示以产品界面实现为准，不能只复制文件就称已显示。 |
| `README.md` | `imports/workbuddy/<包名>/README.md` | 原文保存，作为团队介绍。 |
| `agentName` 指向的主理人 Markdown | `imports/workbuddy/<包名>/agents/` 原文；Profile 根目录 `SOUL.md` 中的精简身份 | 原文完整保留；从清单及文件 frontmatter 的名称、职业、描述生成简短 `SOUL.md`。不要把 WorkBuddy 专有工具调用、`name/subagent_type`、`SendMessage` 指令原封不动写入 SOUL。 |
| 其他 `agents/*.md` | 同一导入记录的 `agents/` | 原文保存并列在成员清单。首版不注册为 Hermes 子 Agent，也不自动改写成独立 Profile。 |
| 清单列出的 `skills/<id>/` | Profile 的 `skills/imports/workbuddy/<包名>/skills/<id>/` | 整目录复制 `SKILL.md`、`scripts/`、`references/`、`templates/`、`assets/` 等；保持相对路径。 |
| 包根目录 `assets/`、`avatars/` | Profile 的 `skills/imports/workbuddy/<包名>/assets/`、`avatars/` | 保持包内层级，使 `<skill-base>/../../assets` 之类引用仍指向原包素材。 |
| 来源包未提供的 `USER.md`、`MEMORY.md` | 无写入 | 保持新 Profile 的默认状态，不把成员角色或 README 当作用户资料和记忆。 |
| 明确声明的 MCP 配置 | Profile 专属 MCP 配置 | 两个样本均无此项。未来新增格式时须单独定义字段、预览、凭据与连接验收；首版不推断。 |

示意路径（实际数据根由产品运行时确定，不使用下载目录作为运行路径）：

```text
<产品数据根>/hermes-home/profiles/gzh-publish-team/
├── SOUL.md
├── config.yaml
├── memories/
└── skills/imports/workbuddy/gzh-publish-team/
    ├── skills/md-image-gen/SKILL.md
    ├── skills/md-image-gen/scripts/generate_images.py
    ├── skills/publish-wechat/...
    ├── assets/...
    └── avatars/...
```

首版把来源包完整复制到同一 Profile 的 `imports/workbuddy/<包名>/`，其中包含 `agents/` 与 README 原文；另复制一份到 `skills/imports/workbuddy/<包名>/`，保持所有 Skill 的跨目录资源相对路径。`import.json` 保存预览摘要、角色和 Skill 清单，不保存来源绝对路径作为跨机器依赖。复制完成后即使原下载目录被移走，已导入的 Skill 仍应可读取。双份复制会增加 Profile 存储占用，后续可在不改变相对路径的前提下优化。

## 4. SOUL.md 的生成规则

新 Profile 的默认 `SOUL.md` 仅作为初始值。导入器生成的内容须简短、确定且可预览：使用 `displayName`、`profession`、包描述、主理人 frontmatter 中的 `displayName` 和 `description` 说明身份与职责；列出已导入 Skill 的名称，并提醒按实际可用工具执行任务。原始主理人 Markdown 完整保存为来源资料，不由程序猜测或改写其中的工作流程。

SOUL 是主理人的身份入口，不承担脚本代码、用户资料或成员调度注册。若用户已有同名 Profile，导入器拒绝覆盖；首版不提供「合并到已有 Profile」，因而不覆盖已有 `SOUL.md`、`USER.md`、`MEMORY.md`。创建后的 SOUL 可在现有「人格与记忆」页面编辑，新会话读取修改。

## 5. 产品接口与界面

### 前端与契约

在专家目录新增「导入 WorkBuddy 专家包」入口，使用现有 `nativeFiles.choose({ directory: true, multiple: false })` 选择目录。选择后调用具名 `DesktopApi.profiles.inspectImport(path)` 返回只读预览：包名、建议 Profile 标识、主理人、成员、Skill、MCP 数量、脚本数量和摘要。用户可改 Profile 标识，并查看待生成的 SOUL；确认后调用 `DesktopApi.profiles.importPackage(path, profileName, expectedDigest)`。导入中禁用重复提交；完成后刷新 Profile 列表，按实际 Gateway 服务状态显示可选或待启用。

首版预览列出包文件、待导入 Skill 与仍需配置的外部能力；只有实际运行时检查后才能称 Skill 已被 Hermes 发现。WorkBuddy `agents/*.md` 不显示为已注册的 Hermes 子 Agent。错误目前是通用校验提示，按文件定位仍待完善。浏览器预览使用模拟宿主数据，不能作为原生导入验收。

### 桌面宿主

新增产品自有 Rust 导入模块，负责本地目录读取、路径与大小校验、复制、文件摘要、目标 Profile 归属和完成状态；Tauri adapter 只转发具名接口。`inspectImport` 不写数据、不运行脚本；`importPackage` 在目标创建前重读并核对摘要，避免预览之后来源改变。命令在作用域登记表中登记为创建 Profile 的 Gateway/运行时级操作，目标只允许落在本产品 `hermes-home/profiles/` 内。

沿用现有 Hermes `create_profile(..., no_alias=True, clone_channels=False)` 创建独立 Profile，不镜像渠道或凭据；导入时传入精简 SOUL 并只预装必需 Skill。当前创建 API 会先公布 Profile，再返回目录；后续复制不是原子的。首版仅在复制完成并写入 `import.json` 后向 UI 报告成功，常规复制错误会删除本次创建的 Profile。若应用在创建后、复制完成前异常退出，可能留下不完整 Profile，重试会因名称冲突被拒绝；自动恢复或安全清理仍待实现。是否能阻止 Gateway 在复制期间服务半成品，需要以锁定运行时实测，不能仅凭 UI 隐藏判断。

### 检查规则

- 只接受包含 `.codebuddy-plugin/plugin.json` 的目录；首版支持清单已验证的 `team` 结构。清单路径必须是包内相对路径，不接受绝对路径、`..`、符号链接、Windows junction 或其他跳出包根的入口。
- 限制总文件数、单文件与总大小；清单、角色与 Skill frontmatter 按 UTF-8 校验。拒绝目标重名、Skill 声明名冲突、缺失的 `SKILL.md` 或清单文件，既不覆盖已有 Profile，也不覆盖预装 Skill。首版错误提示仍是通用校验错误，逐文件定位尚待完善。
- 整目录复制不执行 `*.py`、`*.sh` 或其他来源代码，不自动安装 `requirements.txt`。首版仅提示脚本、外部服务或模型需要另行配置验证，不提取依赖名称；不读取、复制或回显来源包之外的凭据。
- 保留完整文件内容及资源层级；`wechat-config.md` 之类占位模板可复制，但不能当成已配置的微信账号。导入成功后再通过 Profile 专属配置入口设置凭据。

## 6. 两个样本的预期导入报告

| 项目 | 公众号运营包 | 内容创作包 |
| --- | --- | --- |
| Profile | `gzh-publish-team` | `ai-content-creator-team` |
| SOUL 主理人 | 文澜的身份与职责摘要 | 司远的身份与职责摘要 |
| 保留的角色原文 | 5 份，含主理人 | 7 份，含主理人 |
| 待 Hermes 发现的 Skill | 9 个，连同脚本、模板、资源 | 1 个，连同参考资料 |
| MCP | 0 | 0 |
| 待配置／待验证 | 火山图像 API、微信账号、Python 依赖、正文／封面实际输出 | WorkBuddy 专有图像、视频、视频理解工具的 Hermes 对应能力 |

公众号包的 `md-image-gen` 文档提到 `VOLCES_TOKEN`，当前脚本实际以 `--api-token` 或默认占位值取令牌；其图像请求还使用 `watermark: true`，与包中「无水印」说明冲突。首版导入报告应如实提示，不在导入时偷偷改来源脚本。内容创作包的多模态模型调用只有 WorkBuddy 使用说明，没有随包实现；导入其 Skill 不等于这些模型在 Hermes 中可用。

## 7. 验收与交付门槛

1. 使用两个样本分别预览并导入；预览数量与清单一致，缺失文件、越界路径、名称冲突及来源变化均在写入前拒绝。
2. 导入后移走原始下载目录，再从目标 Profile 读取 SOUL、角色原文、全部 Skill 的 `SKILL.md` 与关键脚本／素材，逐文件摘要与来源一致；公众号包的包根 `assets/` 相对引用仍成立。
3. 新建会话核对主理人身份已加载；`USER.md`、`MEMORY.md` 未被角色内容污染。用 Hermes 的实际 Skill 列表核对 9 个与 1 个 Skill 均可发现且没有同名歧义。
4. 创建失败、复制中断和 Gateway 未服务分别显示真实状态；重试不得重复创建或覆盖已有 Profile。导入 A 不改变 default 或 B 的配置、Skill、个人文件及凭据。
5. Windows 与 macOS 分别执行目录选择、导入、Profile 切换和文件读取验证；Python 脚本与外部 API 的真实运行是额外验收，未执行时报告「待验证」。前端模拟、Rust 单测、构建和 Gateway 冒烟不能写成两端原生实机通过。

按改动范围运行现有前端类型检查与构建、契约／架构检查、Rust 格式／编译／测试及针对性导入测试。实现完成后更新 `ROADMAP.md` 的对应版本，记录实际命令、平台和未完成项；按仓库 PR 门槛提交，不改 Hermes fork。
