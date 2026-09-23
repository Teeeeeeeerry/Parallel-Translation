# 调研：特定网页上的“专业化翻译”机制

调研日期：2026-09-21。用途：作为 /grill-with-docs 讨论的输入。本文只梳理“别人怎么做、有哪些可选机制”，不给最终方案。

标注约定：

- **已核实**：读过一手来源（官方文档、官方仓库源码或配置文件、官方打包产物），结论能在链接处直接找到。
- **推测**：根据一手材料推断出来的，原文没有直接写。
- **未找到**：查了，但没找到一手依据。
- 源码链接都固定到调研时的 commit，行号以该 commit 为准。

---

## 1. 摘要

1. 沉浸式翻译把“专业化”拆成三套**互相独立、都按 URL 匹配**的数据：站点 DOM 规则（`rules`，共 774 条，决定翻译哪些元素）、AI 专家（按领域或站点编写的提示词预设，yml 里带 `matches`）、术语库（CSV 加 meta JSON，也带 `matches`）。三套数据都在公开的 GitHub 仓库里维护，扩展运行时从远程拉取。（已核实）
2. AI 专家本质上是一组可以插入变量的提示词模板（`systemPrompt`、`multiplePrompt`、`subtitlePrompt`、`env`、`langOverrides` 等）。选“智能选择”时，扩展按当前 URL 取第一个 `matches` 命中的专家；用户也可以固定选某一个，或者通过 `aiAssistantsMatches` 用 `[+]`、`[-]` 增删某个专家匹配的站点。（配置和 changelog 已核实；选择逻辑是从压缩后的打包代码里读出来的）
3. 沉浸式翻译对 LLM 和传统机翻用了两种不同的术语注入方式。LLM 引擎：只挑出当前段落里**真正出现**的术语，写成 `'k': 'v'` 列表，填进提示词的 `{{terms_prompt}}`。机翻引擎：先把术语换成占位符，译文回来再还原，而且这个功能默认关闭（`enableMachineTranslateTerms: false`）。它**没有**调用 DeepL 的 glossary、context、custom_instructions 这些 API 参数。（已核实，依据是打包代码）
4. 沉浸式翻译的站点规则字段分成几类：限定范围的（`selectors`、`excludeSelectors`、`stayOriginalSelectors`、`atomicBlockSelectors`……），增量修改的（`.add`、`.remove` 后缀），按版本生效的（`.add_v.[x.y.z]`），按条件合并的（`advanceMergeConfig` 加 `condition`）。优先级从高到低是：命中的 `rules`、`generalRule`、内置默认值。（已核实）
5. DeepL 的“领域专业化”手段都在 API 参数里：`glossary_id`（最多 5 个的 `glossary_ids`，必须同时给 `source_lang`）、`context`（不计费，只起消歧作用，文档明确说不要当提示词用）、`custom_instructions`（每次请求最多 10 条，每条最多 300 字符，只支持 de/en/es/fr/it/ja/ko/zh 这几种目标语言）、`style_id`（存在账户里的风格规则列表，目前只对 Pro API 开放）、`formality`、`tag_handling=html` 加 `translate="no"` 或 `class="notranslate"`、`model_type`。（已核实）
6. DeepL glossary 的 v3 端点支持多语言对、可以编辑；v2 的 glossary 一旦创建就不能改。翻译请求本身仍然走 `/v2/translate`。glossary 要先存到用户账户里，拿到 ID 再引用，不能在翻译请求里直接带上词条。这一点和“扩展本地保存术语表”的模式天然冲突。（已核实）
7. DeepL 自己的浏览器扩展：没找到按站点定制翻译风格或术语的一手资料。商店页只提到配合 Pro 账户使用 glossary；帮助中心有 Cloudflare 验证，没能读到全文。（部分未找到）
8. 开源实现里，read-frog（同样基于 WXT、GPL-3.0）最值得对照：它有内置规则加用户规则的 `siteRules` 体系，字段风格和沉浸式翻译高度相似；术语表存在 IndexedDB，每个术语表带 `matchPatterns`，只注入给基于提示词的引擎；渲染后的提示词会计入缓存 key。kiss-translator 则把规则、术语、指定引擎（`apiSlug`）都放进同一条按 URL 匹配的规则里，规则按 全局 < 订阅 < 个人 的顺序合并。（已核实）

---

## 2. 沉浸式翻译（Immersive Translate）

沉浸式翻译的扩展本体不开源，但官方 GitHub 组织下有四个公开仓库可以读：

| 仓库 | 内容 | 调研时 commit |
|---|---|---|
| [immersive-translate/immersive-translate](https://github.com/immersive-translate/immersive-translate) | 打包好的扩展产物（`dist/chrome` 等，1.33.1 版，代码已压缩） | `fd884ea` |
| [immersive-translate/config](https://github.com/immersive-translate/config) | 线上下发的 `dist/default_config.json`（含全部站点规则），以及 Cloudflare Worker 模板 | `766ef19` |
| [immersive-translate/prompts](https://github.com/immersive-translate/prompts) | AI 专家的 yml 源文件 | `b321df9` |
| [immersive-translate/terms](https://github.com/immersive-translate/terms) | 公共术语库（CSV 和 meta JSON） | `eb59a2c` |

以上四个仓库**都没有 LICENSE 文件**，GitHub API 返回的 license 也是空的（已核实）。这会影响能不能直接复用这些数据，见第 7 节。

### 2.1 AI 专家（翻译专家）

**是什么。** 官方仓库的 README 说，AI 专家本质上就是一组精心设计的提示词（[prompts/README.md](https://github.com/immersive-translate/prompts/blob/b321df9e4feb74f73570da112eaa8358da051be6/README.md)）。仓库的 `plugins/` 目录下有 29 个 yml 文件，分成两类：

- 领域专家：tech、legal、medical、financial、paper、news、fiction、game、web3 等；
- 站点专家：github、twitter、reddit、ao3、steam 等。

默认配置里的 `aiAssistantIds` 列出了预装的专家 ID（[config/dist/default_config.json#L158](https://github.com/immersive-translate/config/blob/766ef199c97df53c7510eb25969fbb752d66da18/dist/default_config.json#L158)）。扩展安装专家时，会从 `BASE_AI_URL + api/plugins/{id}.json` 拉取专家定义（依据 `dist/chrome/background.js` 打包代码，已核实）。也就是说，**专家是远程下发的**，不是打包在扩展里的。

**yml 结构（已核实，以 github.yml 为例）。** 参见 [plugins/github.yml](https://github.com/immersive-translate/prompts/blob/b321df9e4feb74f73570da112eaa8358da051be6/plugins/github.yml)：

| 字段 | 作用 |
|---|---|
| `id`、`version`、`extensionVersion` | 标识、专家版本、要求的最低扩展版本 |
| `name`、`description`、`details`、`avatar`、`i18n` | 展示信息（至少要有 zh-CN 和 zh-TW） |
| `matches` | **站点关联**，例如 `https://github.com/*`（[L30](https://github.com/immersive-translate/prompts/blob/b321df9e4feb74f73570da112eaa8358da051be6/plugins/github.yml#L30)）；tech.yml 列了 23 个科技媒体站点（[L30](https://github.com/immersive-translate/prompts/blob/b321df9e4feb74f73570da112eaa8358da051be6/plugins/tech.yml#L30)）。29 个专家里有 19 个带 `matches` |
| `systemPrompt`、`multipleSystemPrompt` | 单段和多段翻译时用的 system 消息 |
| `prompt`、`multiplePrompt`、`subtitlePrompt` | user 消息模板（单段、多段、字幕） |
| `aiBatch.taskSystemPrompt` | 新版批量协议下只描述“任务语义”，协议部分由翻译服务负责（[L4](https://github.com/immersive-translate/prompts/blob/b321df9e4feb74f73570da112eaa8358da051be6/plugins/github.yml#L4)） |
| `env` | 自定义变量，比如 `imt_source_field`、`imt_yaml_item`、`normal_result_yaml_example`，用来把输入输出组织成 YAML 结构（[L32](https://github.com/immersive-translate/prompts/blob/b321df9e4feb74f73570da112eaa8358da051be6/plugins/github.yml#L32)） |
| `langOverrides` | 按语言对覆盖提示词，例如 `auto2zh-TW`（README 中“意译大师”的示例） |
| `maxTextGroupLengthPerRequest` | 专家可以限制每次请求带几段。twitter.yml 设成 1，就是一条推文发一次请求（[L36](https://github.com/immersive-translate/prompts/blob/b321df9e4feb74f73570da112eaa8358da051be6/plugins/twitter.yml#L36)） |
| `enableRichTranslate` | 是否保留行内 HTML 结构 |
| `xxx.add_v.[1.17.2]`、`xxx.remove_v.[1.17.2]` | 按扩展版本生效的字段，同一个文件可以同时兼容新旧版本扩展 |

仓库里还有 `plugins/__tests__/<id>.test.yml`，是给专家写的回归用例，字段包括 `mustPreserve`、`mustContainAny`、`mustNotContain`、`maxLengthRatio` 和人工评审标准 `reviewCriteria`（[legal.test.yml](https://github.com/immersive-translate/prompts/blob/b321df9e4feb74f73570da112eaa8358da051be6/plugins/__tests__/legal.test.yml)）。可以看出，他们把提示词当成需要测试的资产来管理。

**模板变量（已核实）。** 参见[官方 Prompt 配置指南](https://immersivetranslate.com/docs/prompts/)：

- 基础变量：`{{text}}`、`{{from}}`、`{{to}}`、`{{content_type}}`（`html` 或 `text`）；
- 上下文变量：`{{title_prompt}}`（网页标题）、`{{summary_prompt}}`（网页摘要）、`{{terms_prompt}}`（相关术语）；
- 高级变量：`{{yaml}}`、`{{html_only}}`。

文档说明摘要和术语提取目前只对 Pro 会员开放。打包配置里这几个上下文变量的默认展开是（依据 [dist/chrome/default_config.json](https://github.com/immersive-translate/immersive-translate/blob/fd884eadc3a450d22055c779272e4eb168aa978b/dist/chrome/default_config.json)，已核实）：

- `title_prompt` 展开为 “Context Awareness” 标题下的 `Title: “{{imt_title}}”`；
- `summary_prompt` 展开为 `Summary: {{imt_theme}}...`；
- `terms_prompt` 展开为 “Required Terminology” 段落，再接 `{{imt_terms}}`，外加两段“带 domain 和不带 domain 的术语怎么处理”的说明（`imt_terms_with_domain`、`imt_terms_without_domain`）。

打包代码里还有一个判断：只要专家的 systemPrompt 含有 `{{summary_prompt}}` 或 `{{terms_prompt}}`，就说明它“需要上下文”，扩展才会去做摘要和术语提取（已核实，依据 `content_main.js` 中的压缩函数）。

**怎么和站点关联（已核实加推测）。**

- [官方 changelog](https://immersivetranslate.com/docs/CHANGELOG/) 1.5.8 版：AI 专家新增“智能选择”模式，按当前网站自动选择最合适的专家。1.6.4 版：“智能选择”下可以为不同网站自定义不同的专家。1.5.1 版：AI 翻译服务可以设置 AI 专家。
- 打包代码（`dist/chrome/content_main.js`，压缩函数，没有稳定行号）里的选择逻辑大致是：
  - 专家 ID 是 `common`：不使用专家；
  - 显式指定了某个专家：直接用它；
  - 否则（智能选择）：在专家列表里找第一个满足三个条件的：`matches` 命中当前 URL、`excludeMatches` 没命中、`languageMatches`（形如 `en2zh-CN`）能对上当前语言对。
- 用户覆盖：用户配置里的 `aiAssistantsMatches[专家id].matches` 会和专家自带的 `matches` 合并。条目前缀 `[+]` 表示追加，`[-]` 表示删除（依据打包代码中的合并函数）。“找第一个命中”意味着列表顺序决定优先级。打包代码按 `priority` 字段排序专家列表，但默认配置里专家的 `priority` 取值没找到。（推测）

**用户能不能自定义（已核实）。** 可以。prompts 仓库的 README 说，在“开发者设置 → Custom AI Assistant”里直接写 yml 就能调试。打包代码会把 `rawUserConfig.customAiAssistants` 和官方专家列表按 `id` 合并，同 ID 时用户版本覆盖官方版本。

### 2.2 站点适配规则

**存放和下发（已核实）。**

- 规则放在 config 仓库的 [`dist/default_config.json`](https://github.com/immersive-translate/config/blob/766ef199c97df53c7510eb25969fbb752d66da18/dist/default_config.json) 里，由 GitHub Actions 从私有的 `immersive-translate/extension` 仓库生成并提交（[deploy_rule.yml](https://github.com/immersive-translate/config/blob/766ef199c97df53c7510eb25969fbb752d66da18/.github/workflows/deploy_rule.yml)）。
- 线上通过 Cloudflare Worker 下发，路径是 `/default_config.json`，支持条件请求（[worker.template.js](https://github.com/immersive-translate/config/blob/766ef199c97df53c7510eb25969fbb752d66da18/worker.template.js)）。字段 `buildinConfigUpdatedAt` 记录这份配置的构建时间。
- 扩展安装包里同时打包了一份 `default_config.json` 作为兜底（在 immersive-translate 仓库的 `dist/chrome/` 下）。
- [FAQ](https://immersivetranslate.com/docs/faq/) 第 19 条：扩展会定期自动同步官方站点规则；打开扩展面板时也会检查一次更新。
- 顶层有个 `"interval": 3600000`（[L182](https://github.com/immersive-translate/config/blob/766ef199c97df53c7510eb25969fbb752d66da18/dist/default_config.json#L182)），可能是同步间隔（1 小时）。（推测，没核实具体语义）

**格式与字段（已核实）。** `rules` 数组从 [L5777](https://github.com/immersive-translate/config/blob/766ef199c97df53c7510eb25969fbb752d66da18/dist/default_config.json#L5777) 开始，共 774 条；每条都有 `id`，750 条有 `matches`。统计所有规则里的字段，出现最多的是：`excludeSelectors.add`（204 条）、`subtitleRule.add`（183）、`imageRule.add`（148）、`mutationExcludeSelectors.add`（121）、`injectedCss.add`（108）、`excludeSelectors`（86）、`selectors`（71）、`globalStyles`（66）。[官方高级自定义文档](https://immersivetranslate.com/docs/advanced/)把字段分成几组：

| 分组 | 字段 | 含义 |
|---|---|---|
| 匹配 | `matches`、`excludeMatches`、`selectorMatches`、`excludeSelectorMatches` | 按 URL 或按页面上是否存在某个选择器来命中。例如 pdf、ebook 阅读器页面就是用 `selectorMatches` 检测 meta 标签来识别的 |
| 翻译范围 | `selectors` | **只**翻译这些元素（会覆盖默认的自动识别） |
| | `excludeSelectors`、`excludeTags` | 不翻译 |
| | `stayOriginalSelectors`、`stayOriginalTags` | 行内元素保持原样（相当于 PT 的 preserve） |
| | `atomicBlockSelectors`、`extraBlockSelectors`、`extraInlineSelectors` | 修正块级或行内的判定 |
| 增量 | `additionalSelectors`、`additionalExcludeSelectors`、`additionalStayOriginalSelectors`，以及任意字段加 `.add` 或 `.remove` | 在默认值基础上增删，不整体覆盖。文档推荐优先用这种方式 |
| 阈值 | `blockMinTextCount`、`blockMinWordCount`、`paragraphMinTextCount`、`containerMinTextCount` | 太短的文本不翻 |
| 样式 | `globalStyles`、`globalAttributes`、`injectedCss`、`translationClasses` | 修改页面样式，给译文加 class |
| 动态内容 | `mutationExcludeSelectors`、`observeUrlChange`、`urlChangeDelay`、`waitForSelectors` | SPA 页面和懒加载 |
| AI 聊天页 | `aiRule.streamingSelector`、`messageWrapperSelector`、`streamingChange` | 等 ChatGPT 这类页面流式输出结束后再翻（例如 `chatOpenai` 规则） |
| 条件合并 | `advanceMergeConfig: [{condition, advanceConfig}]` | 按平台或扩展版本号等条件额外合并一段配置（例如 `versionNumber>13100`） |

两个真实例子：

- [github 规则](https://github.com/immersive-translate/config/blob/766ef199c97df53c7510eb25969fbb752d66da18/dist/default_config.json#L7459)：用 `excludeMatches` 排除 settings、pricing 等页面，用 `selectors` 列出 `.markdown-body`、`[itemprop=description]` 等正文区域。
- [twitter 规则](https://github.com/immersive-translate/config/blob/766ef199c97df53c7510eb25969fbb752d66da18/dist/default_config.json#L6500)：`selectors` 精确到 `[data-testid='tweetText']`，并用 `additionalStayOriginalSelectors` 保留推文里的链接。

**合并优先级（已核实）。** 文档写的是：命中的 `rules` 高于 `generalRule`，`generalRule` 高于内置默认值。用户规则可以写 `"id": "twitter"` 复用内置规则，再做增量修改。用户规则放在“开发者设置”里，是一个 JSON 数组。`generalRule`（[L4034](https://github.com/immersive-translate/config/blob/766ef199c97df53c7510eb25969fbb752d66da18/dist/default_config.json#L4034)）是所有站点共用的底层默认值。

### 2.3 术语表

**公共术语库的格式（已核实）。** 参见 [terms/README.md](https://github.com/immersive-translate/terms/blob/eb59a2c3ba2c0453d9db50d15fc75512f8609c12/README.md)：

- `glossaries/[meta_name]_[lang].csv`：表头固定为 `source,target,tgt_lng`，UTF-8 编码。`target` 为空的写法在 `tech.csv` 里用来表示“保持原文”，比如 `GPT,`、`Claude,`。
- `meta/[meta_name].json`：字段有 `id`、`name`、`description`、`author`、`glossary`、`langs`（可以含 `auto`，表示适用任何目标语言）、`i18ns`，以及可选的 **`matches`**，用来限定术语库生效的站点。不写 `matches` 就对所有站点生效。
- README 明确建议：领域或站点专用的术语库要配 `matches`；同一个源词在不同语境下译法不同时，要拆成更具体的源词，或者用 `matches` 隔开。
- 用户配置里的术语用 `{k, v}` 表示（`generalRule.glossaries`，[L4147](https://github.com/immersive-translate/config/blob/766ef199c97df53c7510eb25969fbb752d66da18/dist/default_config.json#L4147)，默认内置 `LLM`、`LLMs` 两条保持原文）。术语库的线上地址前缀是 `termsBaseUrl`（[L443](https://github.com/immersive-translate/config/blob/766ef199c97df53c7510eb25969fbb752d66da18/dist/default_config.json#L443)）。

**对 LLM 引擎的注入方式（已核实，依据 `dist/chrome/content_main.js` 打包代码）。**

1. 按段落文本挑出**实际出现**的术语（`getMatchingGlossaries`），每批请求把术语去重后一起带上。
2. 拼成 `'source[domain]': 'target'` 形式的列表，用逗号连接，填入 `imt_terms`。`target` 为空时写原词，表示保持原文。
3. 列表里有带 `[domain]` 的条目时，才拼接 `imt_terms_with_domain` 那段说明；有不带 domain 的条目时，才拼接 `imt_terms_without_domain` 那段说明。
4. 结果进入专家提示词里的 `{{terms_prompt}}`；没有匹配到任何术语时，这些变量都置空。
5. `termsDomainWithSelf`（[L17](https://github.com/immersive-translate/config/blob/766ef199c97df53c7510eb25969fbb752d66da18/dist/default_config.json#L17)，默认 false）打开后，会用术语库的名字作为 domain 标签（文档原话是 “context labels from glossary names”，见[高级自定义文档](https://immersivetranslate.com/docs/advanced/)）。

**对传统机翻引擎的注入方式（已核实）。**

- 由 `enableMachineTranslateTerms` 控制（[L16](https://github.com/immersive-translate/config/blob/766ef199c97df53c7510eb25969fbb752d66da18/dist/default_config.json#L16)），默认关闭，文档也写着不推荐。
- 打开后，打包代码用正则把命中的术语替换成占位符（英文等有空格分词的语言按 `\b` 词边界匹配），占位符和目标译文的对应关系存在 `variables` 里，译文回来后再换回去。
- 这和 PT 现有的 preserve 占位符机制是同一个思路。
- 打包代码里**没有出现** DeepL 的 `glossary_id`、`custom_instructions`、`style_id` 字段（已核实：在全部 js bundle 里 grep 结果为 0）。可见沉浸式翻译没有接入 DeepL 账户级别的 glossary。

**changelog 里的相关记录（已核实）。** 参见 [CHANGELOG](https://immersivetranslate.com/docs/CHANGELOG/)：1.16.5 版（2025-04-22）新增 AI 术语库管理，只支持 AI 翻译服务；1.14.16 版更新术语后不会重新发起翻译请求；1.12.4 版新增 AI 上下文感知翻译（Pro 会员专用）。

### 2.4 按站点选择引擎或设置

- **文档写法（已核实文档，代码路径没有逐一核实）。** [高级自定义文档](https://immersivetranslate.com/docs/advanced/)给了在 `translationServices.<服务名>` 下写 `matches` 的例子（示例是 deepl 加 `sci-hub.se`），并可以按站点调整 `limit`、`requestTimeout`、`maxTextLengthPerRequest`、`apiUrl`。
- **`accurateConfigs`（已核实）。** 默认配置里有一项 `accurateConfigs`（[L60](https://github.com/immersive-translate/config/blob/766ef199c97df53c7510eb25969fbb752d66da18/dist/default_config.json#L60)），把 URL 匹配和“服务、专家、是否开启 AI 上下文”绑在一起。现有唯一的条目是 AO3：命中 `archiveofourown.org` 等站点时，用 `deepseek-pro` 服务、`assistantId: "ao3"`、`enableAIContext: true`，但默认 `enable: false`。打包代码里的处理是：命中并启用时，直接替换当前页面的 `translationService` 和对应的服务配置。这是“站点 → 引擎 + 专家”组合预设的一个实例。
- **其他按 URL 生效的开关（已核实）。** `translationModeUrlPattern`（按 URL 决定双语还是只显示译文）、`translationThemePatterns`（按 URL 决定译文样式），还有 1.29.9 版加入的按站点字幕开关。

---

## 3. DeepL

这一节的一手来源是 [developers.deepl.com](https://developers.deepl.com/)（文档站提供 `.md` 原文）以及它的 [API changelog](https://developers.deepl.com/docs/resources/roadmap-and-release-notes)。

### 3.1 Glossary API

**v2 与 v3（已核实）。** 参见 [Glossary v2 vs v3 Endpoints](https://developers.deepl.com/docs/customize/glossary-v2-vs-v3-endpoints)：

- v2 的 glossary 只有一个语言对，**创建后不能修改**。要改的话只能按“取回词条、本地修改、删除旧表、同名重建”的流程走。
- v3（2025 年第二季度发布）：一个 glossary 里可以包含多个 **dictionary**，每个 dictionary 对应一个语言方向，可以编辑（`PUT` 整个替换某个 dictionary，`PATCH` 把词条合并进去）。
- v3 只负责管理 glossary。**翻译请求仍然走 `/v2/translate`**，在请求里用 `glossary_id` 引用。
- 两个版本创建的 glossary 可以互相引用，但不要在同一个集成里混用：用 v3 编辑过的 glossary，v2 就读不对了。

**使用方式与限制（已核实）。** 参见 [Managing Glossaries](https://developers.deepl.com/docs/customize/managing-glossaries) 和 [translate API](https://developers.deepl.com/api-reference/translate)：

- 翻译时传 `glossary_id`；2026-06-23 起也可以传 `glossary_ids`（最多 5 个，和 `glossary_id` 互斥，而且每个 glossary 都必须有当前语言对的 dictionary）。
- **必须同时设置 `source_lang`**，文档原话是 glossary 目前 “can't yet be used with automatic source language detection”。PT 现在的 DeepL 适配器在源语言为 `auto` 时不传 `source_lang`（`src/engines/deepl.ts` 中的 `buildRequest`），所以要用 glossary，就得先确定源语言。
- glossary 按根语言生效：目标语言写 `EN` 的 glossary 对 `EN-US` 和 `EN-GB` 都有效，创建时必须用根语言代码。
- 词条格式是 TSV（默认）或 CSV，每行一条，源词在前。CSV 可以在词条后面追加源语言和目标语言列，语言对不符的行会被忽略。
- 限制：每个 dictionary 最多 10 MB；名称和每个词条各自不超过 1024 UTF-8 字节；源词不能重复，源词和目标词都不能为空；词条前后不能有空白，也不能包含控制字符。每个账户能建多少个 glossary 由套餐决定。create 端点的 OpenAPI 描述里写的是每个账户 1000 个，不同页面的说法不完全一致。
- 支持的语言：用 `GET /v3/languages?resource=glossary` 查询。
- 目标词不能为空，所以“保持原文”只能把目标词写成和源词一样。read-frog 的注释也提到了这一点，见 4.2 节。
- glossary 和 style rules 都按 DeepL 的数据中心分别存放，走区域端点的客户端访问不到在网页 UI 上创建的这些资源（[Customize 总览](https://developers.deepl.com/docs/customize/overview)）。

### 3.2 与“领域专业化”相关的请求参数

以下均已核实，依据是 [translate API 参考](https://developers.deepl.com/api-reference/translate)及各专题页。

| 参数 | 要点 | 来源 |
|---|---|---|
| `context` | 提供上下文，**本身不会被翻译，也不计费**；本身没有长度上限，但整个请求体不能超过 128 KiB；一次请求里有多条 `text` 时，这段 context 对每一条都生效。2024 年第二季度转为正式功能（GA）。**官方明确说不要当提示词用**：写“用友好的语气”“某个词总是译成某某”这类指令，结果不可预测；它只适合消歧义、提示性别、统一人名音译 | [How to Use the Context Parameter](https://developers.deepl.com/docs/learning-how-tos/examples-and-guides/how-to-use-context-parameter) |
| `text[]` 的独立性 | 数组里的每条文本**各自独立翻译，彼此不共享上下文** | 同上 |
| `formality` | 取值 `default`、`more`、`less`、`prefer_more`、`prefer_less`。目标语言不支持 formality 时，前三个值会让请求失败，`prefer_*` 则会自动回退到默认 | translate API 的 `Formality` schema |
| `model_type` | `latency_optimized`（不传时的默认值）、`quality_optimized`、`prefer_quality_optimized`（旧值，现在等同于 quality）。2026-06-17 起所有功能都兼容全部 model_type | [Understanding Model Types](https://developers.deepl.com/docs/translate/understanding-model-types)、changelog |
| `tag_handling` | `html` 或 `xml`。配合 `tag_handling_version=v2` 使用新算法（2025 年第四季度发布，将来会成为默认）。HTML 模式下，带 `translate="no"` 或 `class="notranslate"` 的元素不会被翻译。设了 `tag_handling=html` 后，`split_sentences` 默认值变为 `nonewlines` | [Translating HTML](https://developers.deepl.com/docs/translate/translating-html) |
| `ignore_tags`、`non_splitting_tags`、`splitting_tags`、`outline_detection` | 只在 XML 模式下用：`ignore_tags` 里的标签内容不翻译；`non_splitting_tags` 让跨多个标签的一句话作为整体翻译；关掉 `outline_detection` 后，要手动用 `splitting_tags` 指定断句位置 | [Translating XML](https://developers.deepl.com/docs/translate/translating-xml) |
| `preserve_formatting`、`split_sentences` | 格式保留与断句控制 | translate API |
| `translation_memory_id`、`translation_memory_threshold` | 复用账户里已有的翻译记忆，匹配阈值默认 75 | translate API |

补充一个对照：沉浸式翻译调用 DeepL 时固定传 `tag_handling: "html"` 和 `model_type: "quality_optimized"`（依据打包代码中的 DeepL 适配器，已核实）。PT 当前的 DeepL 适配器两者都没传（`src/engines/deepl.ts`）。

### 3.3 Style rules 与 custom instructions

**Custom instructions（已核实）。** 参见[专题页](https://developers.deepl.com/docs/customize/custom-instructions)：

- 2025 年第四季度作为 `/v2/translate` 的参数 `custom_instructions` 上线，值是字符串数组。
- 每次请求**最多 10 条，每条最多 300 字符**；目标语言只能是 `de`、`en`、`es`、`fr`、`it`、`ja`、`ko`、`zh` 及其变体。
- 指令是逐句、逐段落应用的，不是翻完后对全文再做一遍修改。因此适合用词、语气、句子结构这类局部调整；像“把列表改写成段落”这种需要看全文的指令，会在每段上各执行一次，反而降低质量。
- 写法建议：用英文或目标语言写；用正面表述；一条只说一件事；写成翻译指令，不要写成聊天式提示词。
- 多条指令之间没有优先级；越宽泛、改动越大的指令影响越强。

**Style rules（已核实）。** 参见 [Using Style Rules](https://developers.deepl.com/docs/customize/using-style-rules)：

- style rule list = 预定义的格式规则（`configured_rules`，比如日期、数字、标点）+ 最多 200 条 custom instructions。它存在账户里，翻译时用 `style_id` 引用，而且请求的目标语言必须和这个列表的 `language` 一致。
- 文档写明 **Style Rules API 目前只对 Pro API 订阅用户开放**。
- 2025 年第四季度先开放了“读取和使用”；2026-03-26 补齐了增删改端点（`POST`、`PATCH`、`DELETE /v3/style_rules`，`PUT .../configured_rules`，以及 custom_instructions 的增删改）。
- 支持的语言和 custom instructions 相同（8 种）。

**custom_instructions 在 Free API 上能不能用（未找到）。** 专题页和 API 参考都没有写套餐限制；[pro-api 页面](https://www.deepl.com/en/pro-api)也没有 API 各套餐的功能对照表。需要用 Free key 实测。

**官方的选型表（已核实）。** 参见 [Customize 总览](https://developers.deepl.com/docs/customize/overview)：术语和品牌名用 glossary；日期、数字、标点格式用 style rules；语气和措辞用 custom instructions；复用已审校过的译文用 translation memory；有歧义的短文本用 context。几种手段可以在同一个请求里组合使用。

### 3.4 DeepL 浏览器扩展

- [Chrome 商店页](https://chromewebstore.google.com/detail/deepl-translate-and-write/cofdbpoegempjloogbagkncekinflcnj)能读到的定制功能只有一句：可以使用公司、领域或客户的 glossary（需要 DeepL Pro）。**没有提到**按站点定制风格或术语。（已核实商店页）
- 帮助中心的 [Change browser extension settings](https://support.deepl.com/hc/en-us/articles/4407573357330-Change-browser-extension-settings) 等文章受 Cloudflare 验证保护，没能读到全文。搜索引擎的摘要显示，扩展可以在当前站点关闭 DeepL 悬浮图标，也就是**按站点开关 UI**，而不是按站点调整翻译。（二手来源，未能核实）
- 结论：**没有找到** DeepL 浏览器扩展按站点定制翻译（术语、风格、引擎参数）的一手证据。

---

## 4. 其他开源实现

### 4.1 kiss-translator（GPL-3.0）

仓库：[fishjar/kiss-translator](https://github.com/fishjar/kiss-translator)，commit `0e6e6a7`。

- **一条规则管所有事（已核实）。** 规则字段见 [`src/config/rules.js#L66-L117`](https://github.com/fishjar/kiss-translator/blob/0e6e6a7935a5621ab1ab1517d1bdc8d3dbb0c872/src/config/rules.js#L66-L117)：
  - URL 匹配：`pattern`（通配符）；
  - DOM：`selector`、`keepSelector`、`blockSelector`、`ignoreSelector`、`rootsSelector`；
  - 术语：`terms`（本地替换）和 `aiTerms`（发给大模型）；
  - 按站点指定引擎和语言：`apiSlug`、`fromLang`、`toLang`；
  - 按站点注入脚本：`injectJs`、`transStartHook`、`transEndHook`。

  值为 `GLOBAL_KEY`（`"*"`）的字段继承全局设置。
- **规则来源与优先级（已核实）。** 内置规则、订阅规则、个人规则三类。订阅规则默认从 `fishjar.github.io/kiss-rules/kiss-rules_v2.json` 拉取（`.env` 中的 `REACT_APP_RULESURL`；`DEFAULT_SUBRULES_LIST` 见 [`src/config/setting.js#L211`](https://github.com/fishjar/kiss-translator/blob/0e6e6a7935a5621ab1ab1517d1bdc8d3dbb0c872/src/config/setting.js#L211)）。合并顺序是全局 < 订阅 < 个人（[`src/libs/rules.js#L245-L247`](https://github.com/fishjar/kiss-translator/blob/0e6e6a7935a5621ab1ab1517d1bdc8d3dbb0c872/src/libs/rules.js#L245-L247)）。
- **两种术语（已核实）。**
  - `terms`：格式是“正则,译文”，在收集文本阶段把命中的词换成占位节点（`<i class=...>`），不交给引擎翻译，所以对任何引擎都有效（[`src/libs/translator.js#L1176`](https://github.com/fishjar/kiss-translator/blob/0e6e6a7935a5621ab1ab1517d1bdc8d3dbb0c872/src/libs/translator.js#L1176)、[`#L3916`](https://github.com/fishjar/kiss-translator/blob/0e6e6a7935a5621ab1ab1517d1bdc8d3dbb0c872/src/libs/translator.js#L3916)）。
  - `aiTerms`：解析成 glossary 对象。批量模式下作为 JSON 请求体的 `glossary` 字段发出；非批量模式下替换提示词里的 `{{glossary}}` 占位符（[`src/apis/trans.js#L148`](https://github.com/fishjar/kiss-translator/blob/0e6e6a7935a5621ab1ab1517d1bdc8d3dbb0c872/src/apis/trans.js#L148)）。
  - 对 Qwen-MT 这类原生支持术语的接口，会转成接口自己的 `terms` 参数（[`src/apis/trans.js#L886`](https://github.com/fishjar/kiss-translator/blob/0e6e6a7935a5621ab1ab1517d1bdc8d3dbb0c872/src/apis/trans.js#L886)）。
- **提示词变量（已核实）。** `{{title}}`、`{{description}}`、`{{summary}}`、`{{context}}`、`{{tone}}`、`{{glossary}}`、`{{url}}` 等（[`src/config/api.js#L17-L30`](https://github.com/fishjar/kiss-translator/blob/0e6e6a7935a5621ab1ab1517d1bdc8d3dbb0c872/src/config/api.js#L17-L30)）。提示词挂在引擎（API 配置）上，不挂在站点规则上；按站点换提示词要靠 `apiSlug` 给站点指定另一套 API 配置来间接实现。（后半句是推测）

### 4.2 read-frog（GPL-3.0，同样基于 WXT）

仓库：[mengxi-ream/read-frog](https://github.com/mengxi-ream/read-frog)，commit `3b6b98d`。

- **站点规则（已核实）。** schema 在 [`src/types/config/site-rules.ts#L21-L74`](https://github.com/mengxi-ream/read-frog/blob/3b6b98d22653e5dfd302b600821cb56fe7f46316/src/types/config/site-rules.ts#L21-L74)，用 zod 定义，字段有：
  - 匹配：`matches`、`excludeMatches`；
  - 选择器：`includeSelectors`、`excludeSelectors`、`preserveTextSelectors`、`atomSelectors`、`forceBlock*`、`forceInline*`，都支持 `.add`、`.remove` 后缀；
  - 标签：`dontWalkTags.add` 等（只提供增量写法，故意不提供整体覆盖）；
  - 其他：`minCharacters`、`injectedCss`。

  文件头注释写明：内置规则和用户规则只要 `matches` 命中就都会应用；数组字段取并集，标量字段后写的生效（用户规则排在后面，所以用户优先）；schema 故意写得宽松，非法的选择器在解析时丢弃并告警，不会因为一条坏规则让整份配置解析失败、回落到默认配置。
- **内置规则（已核实加推测）。** 内置规则打包在扩展里（[`src/utils/site-rules/built-in/rules.json`](https://github.com/mengxi-ream/read-frog/blob/3b6b98d22653e5dfd302b600821cb56fe7f46316/src/utils/site-rules/built-in/rules.json)，484 条），不走远程下发。其中的 `github` 规则和沉浸式翻译的 github 规则 `excludeMatches` 完全一致，还有多条规则引用了 `#immersive-translate-caption-window`。据此推测这些数据来源于沉浸式翻译的规则。（推测，仓库里没找到来源说明）
- **术语表（已核实）。**
  - 词条存在 IndexedDB（Dexie）里，而不是放进配置：注释说两万条术语会让每批翻译多花约 1.9 ms 做 JSON 解析（[`src/types/config/glossary.ts`](https://github.com/mengxi-ream/read-frog/blob/3b6b98d22653e5dfd302b600821cb56fe7f46316/src/types/config/glossary.ts)）。
  - 每个术语表带 `matchPatterns`，留空表示所有站点（[`src/utils/db/dexie/tables/glossary.ts#L30`](https://github.com/mengxi-ream/read-frog/blob/3b6b98d22653e5dfd302b600821cb56fe7f46316/src/utils/db/dexie/tables/glossary.ts#L30)）。
  - 每条术语有 `targetLang`、`caseSensitive`、`enabled` 字段；`target` 为空表示保持原文（[`glossary-term.ts`](https://github.com/mengxi-ream/read-frog/blob/3b6b98d22653e5dfd302b600821cb56fe7f46316/src/utils/db/dexie/tables/glossary-term.ts)）。
- **注入方式（已核实）。** 参见 [`src/utils/glossary/prompt.ts`](https://github.com/mengxi-ream/read-frog/blob/3b6b98d22653e5dfd302b600821cb56fe7f46316/src/utils/glossary/prompt.ts)：
  - 只把命中的术语写成 `A => B` 或 `A => KEEP ORIGINAL`，追加到 system prompt 末尾，前面带一段“Terminology Rules”说明；
  - 注释说明故意不放输入输出示例，因为他们测到加示例会让模型更多地输出空结果；
  - 没有命中任何术语时，提示词必须和不启用术语表时**逐字节相同**，因为渲染后的提示词是翻译缓存 key 的一部分。
  - 术语表只作用于基于提示词的功能（[`features.ts`](https://github.com/mengxi-ream/read-frog/blob/3b6b98d22653e5dfd302b600821cb56fe7f46316/src/utils/glossary/features.ts)）；`api/deepl.ts` 和 `api/microsoft.ts` 里 grep 不到 glossary 相关代码。
- **自定义提示词（已核实）。** `customPromptsConfig` 是全局的 `promptId` 加一组 `patterns`，每个 pattern 只有 `{name, id, systemPrompt, prompt}` 四个字段（[`src/types/config/translate.ts#L63`](https://github.com/mengxi-ream/read-frog/blob/3b6b98d22653e5dfd302b600821cb56fe7f46316/src/types/config/translate.ts#L63)），**没有按站点匹配的字段**。页面上下文（`webTitle`、`webContent`、`webSummary`）会注入提示词，并计入缓存哈希（[`translate-text.ts#L160-L171`](https://github.com/mengxi-ream/read-frog/blob/3b6b98d22653e5dfd302b600821cb56fe7f46316/src/utils/host/translate/translate-text.ts#L160-L171)）。

### 4.3 openai-translator（AGPL-3.0）

仓库：[openai-translator/openai-translator](https://github.com/openai-translator/openai-translator)，commit `a9681a4`。

它主要做划词翻译，用户可以自定义“动作”（action），每个动作带 `rolePrompt` 和 `commandPrompt`，支持 `${sourceLang}`、`${targetLang}`、`${text}` 三个占位符（[`src/common/translate.ts#L236-L260`](https://github.com/openai-translator/openai-translator/blob/a9681a4ab0599bef7013e29fca701f250d7738a2/src/common/translate.ts#L236-L260)）。**没找到**按站点匹配的机制。（已核实，依据 grep 结果）

### 4.4 Traduzir-paginas-web（MPL-2.0）

仓库：[FilipePS/Traduzir-paginas-web](https://github.com/FilipePS/Traduzir-paginas-web)，commit `50a9211`。

- 站点维度只有 `alwaysTranslateSites`、`neverTranslateSites`（[`src/lib/config.js#L22-L23`](https://github.com/FilipePS/Traduzir-paginas-web/blob/50a92116542ab93524594cc210f4bf4e5d86a925/src/lib/config.js#L22-L23)），和 PT 现在的 site-filter 同一层级。
- `customDictionary` 是全局的自定义词典：先把关键词换成占位标记再送去翻译，译文回来后替换回来；只匹配两边是标点或分隔符的完整词，因此代码注释承认对中文、缅甸语等不用空格分词的语言不起作用；对 bing 引擎禁用（[`src/contentScript/pageTranslator.js#L40`](https://github.com/FilipePS/Traduzir-paginas-web/blob/50a92116542ab93524594cc210f4bf4e5d86a925/src/contentScript/pageTranslator.js#L40)、[`#L117`](https://github.com/FilipePS/Traduzir-paginas-web/blob/50a92116542ab93524594cc210f4bf4e5d86a925/src/contentScript/pageTranslator.js#L117)）。（已核实）

---

## 5. 机制对照表

PT 层级说明：

- **DOM 层**：`src/dom/compat.ts`、`walker.ts`、`text.ts`；
- **引擎层**：`src/engines/*`，目前 `buildNumberedPrompt` 只有一个 user 消息，没有 system 消息；
- **存储和 options 层**：`src/storage/schema.ts` 的 `Settings`，以及 options 页；
- **编排层**：`src/orchestration`、`router`、缓存 `src/storage/cache.ts`。

| 机制 | 沉浸式翻译 | DeepL API | kiss-translator | read-frog | PT 现状 | 对应的 PT 层 |
|---|---|---|---|---|---|---|
| 按站点决定翻译哪些元素（include） | `selectors`、`additionalSelectors` | 无（调用方自行决定） | `selector`、`rootsSelector` | `includeSelectors` | 无；只能靠 compat 的 `take` 改指到别的元素 | DOM 层 |
| 按站点排除元素 | `excludeSelectors`、`excludeTags` | `translate="no"` 或 `ignore_tags`（在请求内部生效） | `ignoreSelector` | `excludeSelectors` | compat `skip`，写死在代码里（YouTube、GitHub） | DOM 层 |
| 保持原文的行内元素 | `stayOriginalSelectors` | `ignore_tags` 或 notranslate | `keepSelector` | `preserveTextSelectors`、`atomSelectors` | compat `preserve`，用占位符（只覆盖 GitHub） | DOM 层（占位符机制在 `text.ts`） |
| 剔除 UI 碎片文本 | `excludeSelectors` 加阈值 | 无 | 无 | 无 | compat `omit` 加通用角标检测 | DOM 层 |
| 块级和行内判定修正 | `atomicBlockSelectors`、`extraBlockSelectors`、`extraInlineSelectors` | `non_splitting_tags`、`splitting_tags` | `blockSelector` | `forceBlock*`、`forceInline*` | 靠 walker 的通用判定 | DOM 层 |
| 规则的增量写法 | `.add`、`.remove`，按版本的 `.add_v.[x]`，`advanceMergeConfig` | 无 | 字段值为 `*` 时继承全局 | `.add`、`.remove` | 无（是 TS 代码，不是数据） | 规则的数据格式（新增） |
| 规则来源 | 内置一份兜底，另外定期从远程拉取；用户规则写在 JSON 里 | 无 | 内置，外加订阅 URL，外加个人规则 | 内置打包，外加用户规则（JSON） | 只有内置代码 | 存储和 options 层、下发方式 |
| 站点提示词预设 | AI 专家（yml，`matches` 加“智能选择”，用户可覆盖和新建） | 无；最接近的是 `style_id` 加 custom_instructions，但它按账户、按目标语言生效，不按站点 | 间接：`apiSlug` 给站点指定另一套 API 配置 | 无（只有全局的 `promptId`） | 无（全局只有一个模板） | 引擎层（prompt），加上存储和 options 层 |
| 领域和语气指令 | 写在专家的 systemPrompt 里 | `custom_instructions`（10 条，每条 300 字符，8 种目标语言），`formality` | 提示词 `{{tone}}` | 自定义提示词 | 无 | 引擎层 |
| 页面上下文（标题、摘要） | `{{title_prompt}}`、`{{summary_prompt}}`（摘要仅限 Pro） | `context`（不计费，只做消歧） | `{{title}}`、`{{description}}`、`{{summary}}` | `webTitle`、`webContent`、`webSummary` | 无；`TranslateRequest` 里没有任何上下文字段 | 引擎层，外加编排层把上下文传下来 |
| 术语表：LLM 引擎 | 只取命中的术语，放进 `{{terms_prompt}}` | 不适用 | `aiTerms` 放进 `{{glossary}}` | 只取命中的术语，以 `A => B` 形式追加到 system 消息 | 无 | 引擎层 |
| 术语表：机翻引擎 | 占位符替换（`enableMachineTranslateTerms`，默认关闭） | 账户级 glossary（`glossary_id`，必须给定 `source_lang`） | `terms` 正则占位符（对所有引擎有效） | 不支持 | 无（已有的 preserve 占位符可以复用） | DOM 层或引擎层的前后处理；DeepL 的 glossary 属于引擎层加账户资源 |
| 术语按站点生效 | 术语库 meta 的 `matches` | 无（按账户） | 写在站点规则里 | 术语表的 `matchPatterns` | 无 | 存储和 options 层 |
| 按站点选引擎 | `accurateConfigs`（URL 对应服务加专家），`translationServices.X.matches`（文档） | 不适用 | `apiSlug` | 没查到 | 无（全局只有一个 `enginePriority`） | 编排层（router），外加存储 |
| 按站点开关翻译 | `blockUrls`、用户黑名单等 | 不适用 | `transOpen` | 有 | `site-filter.ts` 黑白名单 | 存储和 options 层 |
| 提示词计入缓存 key | 未核实 | 不适用 | 未核实 | 是（渲染后的提示词直接进缓存 key） | 否（key 只由引擎、源语言、目标语言、模型、文本哈希组成） | 编排层和缓存 |

---

## 6. 对 Parallel-Translation 的启示（可选方向与取舍）

下面只列出可选方向和各自的代价，不给结论。

### 6.1 站点规则：继续写 TS 代码，还是改成数据

- **方向 A：保留 compat.ts 作为“兜底层”，只做通用规则。** 这是现状，符合文件头“每加一条都意味着一处通用逻辑的缺陷”的原则。代价是覆盖面增长慢，用户也没法自己修。
- **方向 B：规则改成 JSON 数据，字段对齐业界写法**（`matches`、`excludeMatches`、`excludeSelectors`、`preserveSelectors` 等，外加 `.add`、`.remove`）。好处是可以接纳用户规则，也能借鉴其他项目的规则思路。代价：
  - 要设计校验和“坏规则不能拖垮整份配置”的容错（read-frog 的宽松 schema 加解析时丢弃，就是一种做法）；
  - `take`（改指到另一个元素）和函数式判断（比如“行内元素且是 favicon 尺寸”）这类逻辑很难用纯选择器表达，可能要保留一个代码层。
- **内置规则与用户规则。** 优先级（用户覆盖内置）和合并语义（数组取并集还是整体覆盖）是必须先定下来的两件事。沉浸式翻译和 read-frog 都选了“数组默认整体覆盖，同时提供 `.add`、`.remove`”这种写法。
- **远程下发与本地打包。**
  - 远程下发（沉浸式翻译、kiss 订阅）：修规则不用发版，但要有服务端或静态托管，还要考虑缓存、版本兼容（沉浸式翻译为此发明了 `add_v.[x]`、`advanceMergeConfig`）。另外，扩展商店对远程拉取的配置会有审核关注，这一点需要作者确认各商店的政策（本文没核实）。
  - 本地打包（read-frog）：规则随版本更新，简单、可审计，但修一条规则就要发一次版。
  - 折中：打包一份，同时允许用户手动导入订阅 URL（kiss 就是这样）。
- **复用第三方规则数据的授权。** 沉浸式翻译的 config、prompts、terms 仓库**都没有 LICENSE**，默认不能认定可以复制。PT 是 GPL-3.0，直接搬运它们的数据有法律风险。read-frog 的内置规则疑似来源于沉浸式翻译，同样不能当作“干净来源”。

### 6.2 站点提示词预设（“专家”）

- **结构。** 最小可用的形态可能是 `{id, matches, systemPrompt, 变量}`。沉浸式翻译的完整结构（多段和单段、字幕、YAML 协议、`langOverrides`、版本字段）是多年演化出来的，PT 未必需要。需要注意的是 PT 现在的编号协议（`buildNumberedPrompt`，靠 `\n` 分隔编号）是由 prompt 和 `parseNumbered` 共同保证的：如果允许用户改整个提示词，就可能破坏编号协议。可选做法有：
  - 只允许改“角色和领域说明”（相当于 system 或 task 部分），协议部分固定。沉浸式翻译的新版 `aiBatch.taskSystemPrompt` 就是这样分层的，协议部分由服务负责，专家不能改；
  - 允许改整个提示词，但接受解析失败的风险，并在失败时回退。
- **消息结构。** PT 的 OpenAI 和 Gemini 目前只发一条 user 消息。加入专家时要决定：专家说明放进 system 消息（OpenAI 的 `system` role，Gemini 的 `systemInstruction`），还是继续拼进 user 消息。
- **选择方式。** 有三种：按 URL 自动匹配（沉浸式翻译的“智能选择”，取第一个命中的）；用户在 popup 里手动选；两者结合（自动匹配，允许手动覆盖）。自动匹配要回答“多个专家同时命中时怎么办”，沉浸式翻译靠列表顺序决定。
- **适用引擎。** 专家只对 LLM 引擎有意义。对 DeepL，可以把专家的一部分映射到 `custom_instructions` 或 `formality`，但 custom_instructions 只支持 8 种目标语言，而且每条最多 300 字符，映射是有损的。
- **缓存。** PT 的缓存 key 目前不含提示词。只要引入站点提示词或术语，同一段原文在不同站点、不同专家下就可能得到不同译文。可选做法：
  - 把渲染后的提示词哈希放进 key（read-frog 的做法，注释里特别强调没有术语时提示词必须逐字节相同）；
  - 把专家 ID 或术语表版本放进 key；
  - 接受缓存串用。

### 6.3 术语表

- **对 LLM 的注入。** 两家做法一致：**只注入当前批次里真正出现的术语**，控制 token 用量，也减少干扰。格式上有 `'k': 'v'` 列表（沉浸式翻译）和 `A => B` 加规则说明（read-frog）两种。“保持原文”要用显式标记表示（read-frog 用 `KEEP ORIGINAL`，注释说空值会让模型自由发挥）。
- **对机翻引擎（Google、Bing）的注入。** 只能用占位符替换：原文里的术语先换成占位符，译文回来后换成目标词。PT 已经有 preserve 占位符机制（`src/dom/text.ts` 配合 compat 的 `shouldPreserveText`），可以扩展成“换成指定译文”。已知的坑：
  - 目标词不会随语法变形；
  - 分词和词边界问题：Traduzir 的注释承认对中文、缅甸语不生效，沉浸式翻译对 CJK 语言不加 `\b`；
  - 占位符可能被机翻引擎弄乱；
  - 沉浸式翻译默认关闭这个功能，说明效果不理想。
- **对 DeepL 的注入。** 有三条路：
  - (a) 和 Google、Bing 一样走占位符；
  - (b) 调 v3 glossary API，在用户账户里创建或更新 glossary，翻译时带 `glossary_id`。代价：要做同步（本地术语表和远端 ID 的对应关系），必须确定 `source_lang`（PT 目前 `auto` 时不传），每个 dictionary 只对应一个语言方向，目标词不能为空，还会写入用户的 DeepL 账户（需要用户明确授权）；
  - (c) 用 `custom_instructions` 写“把 X 译作 Y”这类指令：受 10 条、300 字符、8 种语言的限制，而且 DeepL 官方把术语场景归给 glossary。
- **存储。** 条目多的话，放进 `chrome.storage` 的 Settings 会拖慢每次读取；read-frog 因此把词条放进了 IndexedDB。术语是否按站点生效（`matches` 或 `matchPatterns`）、是否按目标语言区分（`tgt_lng`、`targetLang`），都要尽早定下来，因为会影响数据结构。
- **来源。** 可以只允许用户自建或导入 CSV，也可以内置领域术语库。内置时同样要注意 6.1 提到的授权问题。

### 6.4 页面上下文

- 给 LLM 带上标题或摘要（沉浸式翻译、kiss、read-frog 都这么做），需要让 `TranslateRequest` 能携带上下文。这是对引擎接口的扩展，也会影响缓存 key。
- 对 DeepL 可以用 `context` 传标题或相邻段落，不计费。但要注意：官方明确说 context 不是指令通道；另外，一次请求里的多条 `text` 共用同一个 context。PT 是按批发送的，同一批段落共用什么样的 context，需要设计。
- 顺手一提：PT 的 DeepL 适配器现在没传 `tag_handling` 和 `model_type`。它们和“专业化”没有直接关系，但会影响 HTML 结构和质量档位，可以一并讨论。

### 6.5 按站点选择引擎

- 可以在站点规则里加 `engine` 或 `enginePriority` 覆盖（类似 kiss 的 `apiSlug`，沉浸式翻译的 `accurateConfigs`），也可以做成“站点 → 引擎 + 专家 + 术语表”的组合预设（`accurateConfigs` 就是这种形态）。
- 牵涉的地方：router 目前读的是全局 `enginePriority`；缓存 key 里本来就有引擎 ID，影响较小；options 页的交互复杂度会上升。

---

## 7. 未解问题

1. **沉浸式翻译 `translationServices.X.matches` 的真实语义**：文档给了例子，但没有在打包代码里确认它是“命中时切换到这个服务”，还是“只对这些站点调整该服务的参数”。
2. **沉浸式翻译顶层 `interval: 3600000` 是不是规则同步间隔**：没核实。
3. **沉浸式翻译“智能选择”在多个专家同时命中时的优先级**：打包代码按 `priority` 排序后取第一个命中的，但没查到默认专家的 `priority` 值，也没查到官方说明。
4. **DeepL Free API 能否使用 `custom_instructions`、glossary**：文档没写套餐差异（Style Rules API 明确只对 Pro 开放）。glossary 数量上限各页说法不一（“由套餐决定”和 “1000 per account”）。需要用 Free key 实测。
5. **DeepL 浏览器扩展的站点级设置**：帮助中心受 Cloudflare 保护，只拿到二手摘要。
6. **第三方规则数据的授权**：沉浸式翻译的规则、专家、术语仓库都没有 LICENSE；read-frog 内置规则的来源没有注明。PT 能否参考或导入这些数据，需要作者判断，必要时去问原作者。
7. **远程下发规则在各扩展商店（Chrome、Edge、Firefox AMO）审核中的定位**：本文没调研商店政策。如果考虑远程下发，需要单独核实。
8. **PT 的编号协议能不能承受用户自定义提示词**：需要实验验证，比如用户改了 system 部分之后，`parseNumbered` 的回填错位率会不会上升。
9. **术语占位符在 Google、Bing 网页端接口上是否稳定保留**：沉浸式翻译默认关闭机翻术语，暗示效果不理想，但没有找到量化数据。
10. **PT 应该“按站点”还是“按领域”组织专业化**：沉浸式翻译两者兼有（站点专家、领域专家、带 matches 的术语库）。这是产品层面的决策，本文不下结论。
