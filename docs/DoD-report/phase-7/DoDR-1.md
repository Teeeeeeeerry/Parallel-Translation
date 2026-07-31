# 阶段 7 DoD 验收报告 #1

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 7 — 设置页完整化与 BYOK |
| 验收依据 | `docs/phases/phase-7-options.md` |
| 被测提交 | `f79f257` feat: 阶段 7/8 —— 设置页完整化 + BYOK 引擎 + 兼容补丁 + 多浏览器适配（分支 `v0.6-options/compat-release`） |
| 同批报告 | [阶段 8 DoDR-1](../phase-8/DoDR-1.md) |
| 验收日期 | 2026-08-01 |
| 环境 | Node 24.14.0 / WXT 0.19.29 / TypeScript 5.9.3 / esbuild 打包的 Node 测试运行器 |
| 验收方式 | 单元与集成断言 95 条（本报告涉及 A~I、L、M 组）+ `pnpm typecheck` + 三目标构建产物核查 |
| **结论** | **不通过** — 95 条中 84 条通过、11 条失败，归为 **5 项缺陷**，其中 2 项为阻断级 |

---

## 1. 缺陷

### P7-1（阻断）i18n 从未接入，且 manifest 缺 `default_locale` 会使扩展无法加载

`public/_locales/` 下三份 `messages.json` 齐备，但全项目 **0 处** `chrome.i18n.getMessage` 调用，`wxt.config.ts` 里 `name` / `description` 是硬编码字面量而非 `__MSG_extName__`，产物 manifest 也没有 `default_locale`。

```
$ grep -rn "i18n.getMessage\|__MSG_" src entrypoints wxt.config.ts
（无输出）
$ python3 -c "import json;print(json.load(open('.output/chrome-mv3/manifest.json')).get('default_locale'))"
None
```

后果分两层：

1. **功能层** —— options 页与 popup 的全部文案写死中文，切换浏览器界面语言不会有任何变化。DoD「切换界面语言后所有文案正确切换」不成立。
2. **加载层** —— Chrome 的规则是：扩展目录里存在 `_locales/`，manifest 就**必须**有 `default_locale`，否则安装时直接报 `Localization used, but default_locale wasn't specified in the manifest` 并拒绝加载。也就是说当前产物在 Chrome 里装不上，而不是「装上了但没翻译」。

失败断言：I-1、I-2、I-3、I-4。

### P7-2（阻断）BYOK 引擎无法被加入优先级列表，配了 key 也永远走不到

`enginePriority` 默认是 `['google-web', 'bing-edge']`，而 `engines.ts` 的 `renderEngineList()` **只渲染 `enginePriority` 数组里已有的项**：

```typescript
function renderEngineList(): string {
  const { enginePriority } = getSettings();
  return enginePriority.map((id, i) => `<li class="pt-engine-item" …>`).join('');
}
```

整个设置页没有任何「添加引擎 / 启用引擎」的入口，`ENGINE_LABELS` 里的 openai / deepl / gemini 三项从不出现在这个列表中。用户能填 key、能「测试连接」并看到成功提示，但那把 key 永远不会被 `route()` 用到 —— 因为 router 只遍历 `enginePriority`。

这使 DoD「三个 BYOK 引擎均能用真实 key 完成翻译」在 UI 路径上不可达：唯一的启用办法是手工编辑导出的 JSON 再导入。

失败断言：M-2。（M-1 确认默认优先级确实不含三个 BYOK 引擎。）

### P7-3 样式预设实时预览完全失效

两处独立的错误叠加，任一处都足以让预览不动：

1. `entrypoints/options/options.css` 只 `@import '../../src/styles/tokens.css'`，**没有引入 `presets.css`**。构建产物 `assets/options-*.css` 中 `.pt-style-dim` / `.pt-style-fade` 等规则一条都没有。
2. 即便引入了也不生效 —— `presets.css` 的选择器是**祖先-后代**形式 `.pt-style-fade .pt-trans`，而 `appearance.ts` 把类名加在了 `.pt-trans` **自己**身上：

```typescript
previewTrans.className = `pt-trans pt-style-preview-trans pt-style-${s.style}`;
```

元素不是自己的祖先，选择器永远匹配不上。结果是六个预设选哪个，预览区都长一个样，而这恰恰是 DoD 写「样式预设要有实时预览」的原因 —— 用文字分不清「弱化」和「半透明」。

失败断言：L-1、L-2。

### P7-4 `Settings.models` 没有任何可视化控件

DoD 第 1 项要求「所有 `Settings` 字段都有对应的可视化控件」。逐字段扫描 `index.html` + `sections/*.ts`，13 个字段有控件，`models` 没有：

| 字段 | 控件 |
|---|---|
| enabled / from / to / displayMode / style / customCss / hotkeys / siteList / showFloatingBall / showParagraphBtn / maxConcurrency / useCache / enginePriority | ✅ |
| **models** | ❌ 无输入框 |

`openai.ts` 与 `gemini.ts` 都在读 `getSettings().models?.<id>`，也就是这个字段是实装并生效的，只是用户改不了 —— 想换成 `gpt-4o` 或 `gemini-2.5-pro` 只能走导入 JSON。

失败断言：H-models。

### P7-5 Gemini 的 API key 放在 URL query string 里

```typescript
const endpoint =
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
```

`engines.ts` 的「测试连接」同样是 `?key=${key}`。URL 会进入浏览器网络日志、DevTools 记录、以及任何中间层的访问日志，而请求头不会。Gemini API 支持 `x-goog-api-key` 请求头，与另两个引擎（`Authorization`）的做法也一致。

失败断言：D-5。

---

## 2. 通过项

DoD 十四项逐条：

| # | DoD 项 | 结果 | 依据 |
|---|---|---|---|
| 1 | 六个分区全部实现，所有 Settings 字段有控件 | ❌ | P7-4（`models` 缺控件） |
| 2 | 任一设置项修改后即时持久化，无需点保存 | ✅ | 六个 section 全部 `change`/`click` → `patchSettings`，无保存按钮 |
| 3 | 引擎优先级可拖拽排序，顺序即故障切换顺序 | ⚠️ | 拖拽实装且 router 按序遍历，但列表内容受 P7-2 限制 |
| 4 | 三个 BYOK 引擎均能用真实 key 完成翻译 | ❌ | P7-2；引擎自身逻辑正确（B/C/D 组 17 条） |
| 5 | 测试连接：有效 key 成功、无效 key 明确报错 | ✅ | `testConnection` 三分支齐备，401/403 → 「API key 无效」 |
| 6 | LLM 翻译 100+ 段落一一对应无错位 | ✅ | A-1 ~ A-10、B-1、D-1 |
| 7 | LLM 漏行时缺失留空而非整体错位 | ✅ | A-2、A-3、B-3、D-4 |
| 8 | 无效 key 直接报错，不触发故障切换 | ✅ | E-1、E-2（后续引擎零请求） |
| 9 | DeepL 不支持的目标语言被 router 跳过 | ✅ | C-7、E-3、E-4 |
| 10 | 快捷键分区按当前系统显示按键符号 | ✅ | `initHotkeys(os)` 全走 `formatHotkey`（阶段 6 已验 A 组 8 条） |
| 11 | 样式预设有实时预览 | ❌ | P7-3 |
| 12 | 自定义 CSS 非法内容即时报错 | ✅ | `validateCss` 拦 `{}` `\` 与 `url()`，400ms 去抖后标红 |
| 13 | 切换界面语言后文案正确切换 | ❌ | P7-1 |
| 14 | 设置导出的 JSON 不含任何 API key | ✅ | G-1 ~ G-6（key 独立存 `chrome.storage.local` 的 `pt-keys`，与 `pt-settings` 物理分离） |

引擎批量策略经断言确认：一次 `translate()` 无论多少段都只发 **1 个** 请求（B-2、D-2），未退化成逐段。

`pnpm typecheck` 0 error。

---

## 3. 待真机自测项

以下判据依赖真实网络或真实浏览器，本轮未覆盖：

- 三个 BYOK 引擎用**真实 key** 的端到端翻译与「测试连接」返回（本轮全部 mock `fetch`）
- 拖拽排序的实际指针交互（HTML5 drag & drop 在 jsdom / Node 中无法复现；参见 [TESTING.md](../../TESTING.md) 关于指针交互必须上 E2E 的结论）
- 切换 Chrome 界面语言后的实际文案（前置是 P7-1 修复）
- 长页面（100+ 段）用真实 LLM 引擎翻译后的逐行错位人工核对
