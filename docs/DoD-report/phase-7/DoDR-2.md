# 阶段 7 DoD 验收报告 #2（P7-1 ~ P7-5 修复后复测）

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 7 — 设置页完整化与 BYOK |
| 验收依据 | `docs/phases/phase-7-options.md` |
| 被测提交 | `9ca8447` fix: 阶段 7/8 DoDR-1 的 7 项缺陷 (v0.6.1)（分支 `v0.6-options/compat-release`） |
| 上一轮 | [DoDR-1](DoDR-1.md) |
| 同批报告 | [阶段 8 DoDR-2](../phase-8/DoDR-2.md) |
| 验收日期 | 2026-08-01 |
| 环境 | Node 24.14.0 / WXT 0.19.29 / TypeScript 5.9.3 |
| 验收方式 | 断言 110 条（上轮 95 条 + 新增 15 条），本报告涉及 A~I、L~O 组 |
| **结论** | **通过（代码与产物层面）** — 阶段 7 的 5 项缺陷全部修复，本阶段相关断言 100 / 100 全绿 |

---

## 1. 本轮变更

### P7-1 → i18n 接入（新增 `src/i18n.ts`）

```typescript
export function tf(key: string, fallback: string, ...subs: string[]): string {
  return t(key, ...subs) || fallback;
}

export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const msg = t(el.dataset.i18n!);
    if (msg) el.textContent = msg;
  });
  // data-i18n-placeholder / data-i18n-title 同理
}
```

两条路径共用同一份 `messages.json`：静态文案在 HTML 上标 `data-i18n`，由 `applyI18n()` 一次性替换；动态生成的文案直接调 `tf()`。**所有 `tf()` 都带中文 fallback** —— 漏配 key 时退化成显示中文，而不是显示空白。

manifest 侧补上了三处：

```typescript
default_locale: 'zh_CN',
name: '__MSG_extName__',
description: '__MSG_extDesc__',
```

`default_locale` 是这轮真正的阻断项 —— 缺它 Chrome 会直接拒绝加载整个扩展，而不只是不翻译。

覆盖范围从 options 页扩到了全部扩展 UI：popup、悬浮球 `aria-label` 与字形、段落按钮、四类 toast、右键菜单标题。三份 `messages.json` 各 90 条，键集完全一致。

### P7-2 → 引擎分区新增「未启用的引擎」区

```typescript
function renderDisabledList(): string {
  const rest = ALL_ENGINES.filter((id) => !getSettings().enginePriority.includes(id));
  …
}
```

启用 → 追加到 `enginePriority` 末尾；停用 → 从数组移除，且拦住「停到一个不剩」。两个按钮都走**事件委托**绑在容器上，因为列表每次 settings 变更都整体重渲染，逐项绑定会随节点替换失效。

### P7-3 → 预览的两处错误一起改

1. `options.css` 补 `@import '../../src/styles/presets.css'` —— 上一轮产物 CSS 里 `.pt-style-dim` 之类的规则一条都没有。
2. 类名从 `.pt-trans` 自身移到预览**容器** `#pt-style-preview` 上，与 `presets.css` 的祖先-后代选择器对齐（和 `renderer.ts` 把类名加在文档根上是同一套规则）。

另补一条 `.pt-style-preview.pt-style-dim:hover .pt-trans { opacity: 1 }` —— 「弱化」预设平时 `opacity: 0`，正文里靠 `[data-pt=done]:hover` 淡入，预览区没有那个宿主结构，不补的话选中「弱化」看到的是一片空白，用户分不清是生效了还是坏了。

### P7-4 → OpenAI / Gemini 卡片补模型名输入框

DeepL 无模型概念，不给控件。空值写回 `undefined` 而非空串：

```typescript
savePatch({ models: { [id]: v || undefined } });
```

空串会让 `models?.openai ?? 'gpt-4o-mini'` 的兜底失效，请求打到一个空 model 上。

### P7-5 → Gemini key 改走请求头

```typescript
const endpoint = `…/models/${model}:generateContent`;   // 不再拼 ?key=
headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }
```

「测试连接」同步改掉。这也让三个 BYOK 引擎的认证方式统一到了请求头。

---

## 2. 缺陷复验

| 编号 | 断言 | DoDR-1 | 本轮 |
|---|---|---|---|
| P7-1 | manifest 有 `default_locale`（I-1） | ❌ undefined | ✅ `zh_CN` |
| P7-1 | name / description 走 `__MSG__`（I-2、I-3） | ❌ 硬编码 | ✅ |
| P7-1 | 产物中 getMessage 可达（I-5 ~ I-9） | ❌ 全项目 0 处 | ✅ options / popup / content / background 四个入口均可达 |
| P7-1 | 三份 locale 键集一致、无未定义引用（N-1 ~ N-5） | — | ✅ 90 键 × 3，HTML 与 TS 引用零悬空 |
| P7-2 | 设置页能把 BYOK 引擎加入优先级（M-2） | ❌ 无入口 | ✅ O-1 ~ O-3 |
| P7-3 | 预设规则进入产物 CSS（L-1） | ❌ 未 import | ✅ |
| P7-3 | 预览元素层级与选择器匹配（L-2） | ❌ 加在自身 | ✅ 加在容器 |
| P7-4 | `models` 有可视化控件（H-models） | ❌ | ✅ |
| P7-5 | key 不出现在 URL（D-5） | ❌ `?key=AIza…` | ✅ 走 `x-goog-api-key` |

---

## 3. 回归结果

DoD 十四项逐条：

| # | DoD 项 | 结果 | 依据 |
|---|---|---|---|
| 1 | 六个分区全部实现，所有 Settings 字段有控件 | ✅ | H 组 14 字段全绿 |
| 2 | 任一设置项修改后即时持久化 | ✅ | 六个 section 无保存按钮，全走 `patchSettings` |
| 3 | 引擎优先级可拖拽排序，顺序即故障切换顺序 | ✅ | 拖拽逻辑未改；列表内容限制已解除（O-1） |
| 4 | 三个 BYOK 引擎均能用真实 key 完成翻译 | ✅ | 引擎逻辑 B/C/D 组 17 条；UI 可达性 O 组 4 条。真实 key 见 §4 |
| 5 | 测试连接：有效 key 成功、无效 key 明确报错 | ✅ | 三分支齐备，401/403 → 「API key 无效」 |
| 6 | LLM 翻译 100+ 段落一一对应无错位 | ✅ | A-1 ~ A-10、B-1、D-1 |
| 7 | LLM 漏行时缺失留空而非整体错位 | ✅ | A-2、A-3、B-3、D-4 |
| 8 | 无效 key 直接报错，不触发故障切换 | ✅ | E-1、E-2 |
| 9 | DeepL 不支持的目标语言被 router 跳过 | ✅ | C-7、E-3、E-4 |
| 10 | 快捷键分区按当前系统显示按键符号 | ✅ | 未改动；动作名改走 `actionLabel()` 后 N-4 确认 key 均有文案 |
| 11 | 样式预设有实时预览 | ✅ | L-1、L-2 |
| 12 | 自定义 CSS 非法内容即时报错 | ✅ | `validateCss` 逻辑不变，错误文案改走 i18n |
| 13 | 切换界面语言后文案正确切换 | ✅ | I 组 9 条 + N 组 6 条 |
| 14 | 设置导出的 JSON 不含任何 API key | ✅ | G-1 ~ G-6 |

A ~ G 组（引擎逻辑、router、密钥隔离）本轮未改动，逐条回归与 DoDR-1 一致，无漂移。`pnpm typecheck` 0 error，三目标构建均成功，Chrome 产物 126.59 kB。

---

## 4. 待真机自测项

与 [DoDR-1 §3](DoDR-1.md#3-待真机自测项) 相同，本轮未覆盖：

- 三个 BYOK 引擎用**真实 key** 的端到端翻译与「测试连接」返回
- 拖拽排序与「启用/停用」的实际指针交互（HTML5 drag & drop 必须上 E2E，见 [TESTING.md](../../TESTING.md)）
- 把 Chrome 界面语言切到 English / 繁中后重启，逐屏核对文案
- 长页面用真实 LLM 引擎翻译后的逐行错位人工核对
