# 阶段 7 — 设置页完整化与 BYOK

## 目标

实现完整的 options 设置页，接入三个 BYOK 引擎（OpenAI / DeepL / Gemini），完成扩展自身 UI 的国际化。本阶段结束后，所有配置项都能在图形界面里查看和修改，高级用户可以填入自己的 API key 使用更高质量的引擎。

## 前置依赖

- 阶段 1：`Settings` schema 与 `getKey()` / `setKey()`
- 阶段 2：`TranslateEngine` 接口与 `REGISTRY`
- 阶段 6：`formatHotkey()` 与录制组件

## 交付文件清单

```
entrypoints/options/
├── index.html
├── main.ts
└── sections/
    ├── general.ts       # 开关、语言对、显示模式
    ├── engines.ts       # 引擎优先级拖拽排序 + BYOK 密钥
    ├── appearance.ts    # 样式预设 + 自定义 CSS
    ├── hotkeys.ts       # 快捷键列表 + 录制
    ├── sites.ts         # 黑白名单
    └── advanced.ts      # 并发数、缓存管理、导入导出

src/engines/
├── openai.ts
├── deepl.ts
└── gemini.ts

public/_locales/
├── zh_CN/messages.json
├── zh_TW/messages.json
└── en/messages.json
```

## 关键代码骨架

### `src/engines/openai.ts`

```typescript
const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

export const openai: TranslateEngine = {
  id: 'openai',
  displayName: 'OpenAI',
  requiresKey: true,
  supportedLangs: 'all',

  async translate({ texts, from, to }) {
    const key = await getKey('openai');
    if (!key) throw new EngineError('openai', false, '未配置 API key');

    // LLM 按次计费，逐段请求成本高且慢 —— 编号后整批送，一次拿回全部
    const numbered = texts.map((t, i) => `${i + 1}. ${t}`).join('\n');
    const prompt =
      `将以下编号文本翻译成${to}${from === 'auto' ? '' : `（源语言${from}）`}。` +
      `严格保持编号与行数一致，只输出译文，不要解释。\n\n${numbered}`;

    const resp = await fetch(DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: getSettings().models?.openai ?? 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      }),
    });

    if (resp.status === 401) throw new EngineError('openai', false, 'API key 无效');
    if (!resp.ok)            throw new EngineError('openai', true, `HTTP ${resp.status}`);

    const data = await resp.json();
    const out = parseNumbered(data.choices[0].message.content, texts.length);
    return { translations: out };
  },
};

/**
 * 解析编号输出。LLM 有概率漏行或多输出，必须做长度对齐 ——
 * 长度不匹配会导致译文错位挂到错误的段落上，比翻译失败更糟。
 */
function parseNumbered(raw: string, expected: number): string[] {
  const map = new Map<number, string>();
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*(\d+)[.、)]\s*(.+)$/);
    if (m) map.set(Number(m[1]), m[2].trim());
  }
  return Array.from({ length: expected }, (_, i) => map.get(i + 1) ?? '');
}
```

### `src/engines/deepl.ts`

```typescript
/** 免费版与 Pro 版端点不同，靠 key 后缀区分 */
function endpointFor(key: string): string {
  return key.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';
}

export const deepl: TranslateEngine = {
  id: 'deepl',
  displayName: 'DeepL',
  requiresKey: true,
  // DeepL 语言覆盖有限，必须显式列出 —— router 依此在不支持时跳过
  supportedLangs: ['zh', 'zh-CN', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'pt', 'it'],

  async translate({ texts, from, to }) { /* text[] 原生支持批量 */ },
};
```

### `src/engines/gemini.ts`

```typescript
export const gemini: TranslateEngine = {
  id: 'gemini',
  displayName: 'Gemini',
  requiresKey: true,
  supportedLangs: 'all',
  // 与 openai 相同的编号批量策略，复用 parseNumbered
  async translate({ texts, from, to }) { /* ... */ },
};
```

### options 页分区结构

```
┌─ 通用 ────────────────────────────────────
│  扩展开关 / 目标语言 / 源语言 / 默认显示模式
├─ 引擎 ────────────────────────────────────
│  优先级列表（拖拽排序，展示故障切换顺序）
│  各引擎的 API key 输入（密码框 + 「测试连接」）
├─ 外观 ────────────────────────────────────
│  6 种样式预设（带实时预览）
│  自定义 CSS（实时校验 + 错误提示）
├─ 快捷键 ──────────────────────────────────
│  动作列表 + formatHotkey 显示 + 录制按钮 + 冲突警告
├─ 站点 ────────────────────────────────────
│  黑/白名单模式切换 + 域名列表增删
└─ 高级 ────────────────────────────────────
   并发数 / 缓存条目数与清空 / 设置导入导出 / 恢复默认
```

### `public/_locales/zh_CN/messages.json`

```json
{
  "extName":     { "message": "Parallel-Translation" },
  "extDesc":     { "message": "对照式网页翻译扩展" },
  "translate":   { "message": "翻译此页" },
  "settings":    { "message": "设置" },
  "styleDim":    { "message": "弱化显示" },
  "styleFade":   { "message": "半透明" },
  "cssNoSelector": { "message": "只需填写 CSS 属性，无需选择器与花括号" }
}
```

## 实现要点与取舍

**LLM 引擎必须批量请求，不能逐段。** OpenAI 与 Gemini 按 token 计费且单次往返有固定延迟。一页 200 段逐个请求，既慢（200 次串行往返）又贵（每次都要重复系统提示的 token）。做法是编号后整批送、一次拿回。

**编号输出必须做长度对齐。** LLM 有概率漏行、多输出或改变编号格式。若直接按行 split 后按顺序取用，一旦行数不匹配，所有译文会整体错位挂到错误段落上 —— 这比翻译失败更糟，因为用户看不出是错的。做法是解析出编号后建 Map，按预期长度回填，缺失项留空。

**BYOK 引擎的 401 是 `retryable: false`。** key 无效换个引擎试也没用（它们各有各的 key），应当直接抛出让用户看到"API key 无效"。若标成 retryable，router 会把所有引擎试一遍，用户等半天最后得到一个笼统的"全部失败"。

**DeepL 的 `supportedLangs` 必须显式列举。** 它的语言覆盖远小于 Google/Bing。声明为 `'all'` 会导致把不支持的语言送过去拿到 400，白白消耗一次故障切换。显式列表让 router 直接跳过。

**DeepL 免费版与 Pro 版端点不同。** 免费 key 以 `:fx` 结尾，必须走 `api-free.deepl.com`。用错端点会得到 403，且错误信息不会提示是端点问题。

**API key 输入框要有「测试连接」。** 用户填错 key 时，若没有即时反馈，只能等到实际翻译失败才发现，而那时错误可能被故障切换掩盖（自动切到了免 key 引擎，翻译"成功"了，用户根本不知道自己的 key 没生效）。

**引擎优先级用拖拽排序而非多选。** 优先级本质是有序列表，这直接对应故障切换的尝试顺序。用一组勾选框表达不了顺序，用户也就无法理解"为什么明明勾了 DeepL 却走了 Google"。

**样式预设要有实时预览。** 6 种样式的差异（尤其是"弱化显示"与"半透明"）用文字描述不清楚。在设置页放一段示例文本，选中哪个就用哪个样式渲染，用户一眼就懂。

**i18n 只覆盖扩展自身 UI。** 译文内容本身与 i18n 无关。首版三种语言（简中、繁中、英文）足够；扩展的主要用户群就是这几类。

**设置导入导出不包含 API key。** 用户分享配置时不应把密钥一起泄漏出去。导出时显式剔除 `pt-keys`。

## DoD 验收标准

- [ ] 六个分区全部实现，所有 `Settings` 字段都有对应的可视化控件
- [ ] 任一设置项修改后即时持久化，无需点「保存」
- [ ] 引擎优先级可拖拽排序，顺序即故障切换顺序
- [ ] 三个 BYOK 引擎均能用真实 key 完成翻译
- [ ] 「测试连接」对有效 key 返回成功、无效 key 返回明确错误
- [ ] LLM 引擎翻译一页 100+ 段落，译文与段落**一一对应无错位**
- [ ] LLM 返回漏行时，缺失段落留空而非整体错位
- [ ] 无效 API key 直接报「API key 无效」，不触发故障切换
- [ ] DeepL 选择不支持的目标语言时被 router 自动跳过
- [ ] 快捷键分区按当前系统正确显示按键符号
- [ ] 样式预设有实时预览
- [ ] 自定义 CSS 输入非法内容时即时报错
- [ ] 切换界面语言后所有文案正确切换
- [ ] 设置导出的 JSON **不含任何 API key**

## 验证步骤

```bash
pnpm dev
```

**BYOK 逐个验证**：在设置页填入真实 key → 点「测试连接」→ 应返回成功 → 将该引擎拖到优先级首位 → 翻译 Wikipedia 页面 → Network 面板确认走了该引擎。

**错位自查**（这是本阶段最关键的验证）：用 LLM 引擎翻译一个长页面，然后在页面 Console 执行：

```javascript
const pairs = [...document.querySelectorAll('[data-pt="done"]')].map(el => ({
  origin: el.querySelector('.pt-origin')?.textContent?.trim().slice(0, 40),
  trans:  el.querySelector('.pt-trans')?.textContent?.trim().slice(0, 40),
}));
console.table(pairs.slice(0, 20));
// 逐行核对：译文语义必须与同行原文对应，不能整体偏移一行
```

**漏行容错**：临时把 `parseNumbered` 的输入改成故意缺一行的字符串，确认结果长度仍等于 `texts.length`，缺失项为空字符串。

**无效 key**：填一个错误的 OpenAI key → 翻译 → 应立即报「API key 无效」，且 Network 面板中**没有**后续的 Google/Bing 请求（证明未触发故障切换）。

**DeepL 跳过**：目标语言设为「阿拉伯语」，引擎优先级设为 `['deepl', 'google-web']` → 翻译 → Network 面板应只见 Google 请求。

**密钥不外泄**：

```javascript
// 设置页 Console
const exported = await exportSettings();
console.log(JSON.stringify(exported).includes('sk-'));   // 预期 false
console.log(Object.keys(exported));                       // 预期不含 pt-keys
```

**i18n**：Chrome 设置里把界面语言切到 English → 重启浏览器 → 扩展所有文案应为英文。
