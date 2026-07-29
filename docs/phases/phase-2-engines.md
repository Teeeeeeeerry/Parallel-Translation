# 阶段 2 — 翻译引擎与最短闭环

## 目标

定死翻译引擎接口，实现两个免 key 引擎与故障切换路由，打通 content script → background → 引擎 → 渲染的完整链路。本阶段结束后，在 Wikipedia 上点击工具栏图标，段落下方出现对照译文。

**这是首个可用产物。** 之前的阶段装得上但没用，从这里开始扩展真的能翻译。

## 前置依赖

- 阶段 0：WXT 骨架、manifest
- 阶段 1：`getSettings()` 可读引擎优先级、语言对；`cacheGet` / `cacheSet` 可用

## 交付文件清单

```
src/engines/
├── types.ts             # TranslateEngine 接口 + 错误类型
├── google-web.ts        # 免 key 引擎
├── bing-edge.ts         # 免 key 引擎，需 JWT
└── router.ts            # 优先级遍历 + 故障切换

src/queue/
└── concurrency.ts       # 并发闸门

src/dom/
├── collect.ts           # 最简节点采集（阶段 3 升级为完整 walker）
└── inject.ts            # 最简译文插入（阶段 4 升级为完整 renderer）

entrypoints/
├── background.ts        # 消息路由 + 引擎调用（fetch 必须在这里）
└── content.ts           # matches: <all_urls>，接收工具栏点击并驱动翻译
```

## 关键代码骨架

### `src/engines/types.ts`

```typescript
export interface TranslateRequest {
  texts: string[];              // 批量，顺序敏感
  from: string | 'auto';
  to: string;
}

export interface TranslateResponse {
  translations: string[];       // 长度与顺序必须与 texts 严格对应
  detectedFrom?: string;
}

export interface TranslateEngine {
  id: string;
  displayName: string;
  requiresKey: boolean;
  supportedLangs: string[] | 'all';
  translate(req: TranslateRequest): Promise<TranslateResponse>;
}

/** 区分可切换与不可切换的失败 —— router 依此决定是否尝试下一个引擎 */
export class EngineError extends Error {
  constructor(
    public engineId: string,
    /** true = 换个引擎可能成功（网络/限流/端点变更）；false = 换也没用（语言不支持） */
    public retryable: boolean,
    message: string,
  ) { super(message); }
}
```

### `src/engines/google-web.ts`

```typescript
const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

export const googleWeb: TranslateEngine = {
  id: 'google-web',
  displayName: 'Google',
  requiresKey: false,
  supportedLangs: 'all',

  async translate({ texts, from, to }) {
    // 该端点单次只接受一段文本，批量靠并发多请求实现
    const translations = await Promise.all(
      texts.map(async text => {
        const qs = new URLSearchParams({
          client: 'gtx',
          sl: from,           // 'auto' 直接可用
          tl: to,
          dt: 't',
          strip: '1',
          nonced: '1',
          q: text,
        });
        const resp = await fetch(`${ENDPOINT}?${qs}`);
        if (!resp.ok) {
          throw new EngineError('google-web', true, `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        // data[0] 是分句数组，每项的 [0] 是该句译文，需拼接
        return (data[0] as any[]).map(seg => seg[0]).join('');
      }),
    );
    return { translations };
  },
};
```

### `src/engines/bing-edge.ts`

```typescript
const AUTH_ENDPOINT  = 'https://edge.microsoft.com/translate/auth';
const TRANS_ENDPOINT = 'https://api-edge.cognitive.microsofttranslator.com/translate';

let cachedJwt: string | null = null;

/** JWT 有效期约 10 分钟，解析 exp 复用，不要每次请求都换 */
async function getJwt(): Promise<string> {
  if (cachedJwt && !isExpired(cachedJwt)) return cachedJwt;
  const resp = await fetch(AUTH_ENDPOINT);
  if (!resp.ok) throw new EngineError('bing-edge', true, `auth HTTP ${resp.status}`);
  cachedJwt = await resp.text();   // 返回的是纯文本 JWT，不是 JSON
  return cachedJwt;
}

function isExpired(jwt: string): boolean {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return Math.floor(Date.now() / 1000) >= payload.exp - 30;   // 留 30s 余量
  } catch { return true; }
}

export const bingEdge: TranslateEngine = {
  id: 'bing-edge',
  displayName: 'Microsoft',
  requiresKey: false,
  supportedLangs: 'all',

  async translate({ texts, from, to }) {
    const jwt = await getJwt();
    const qs = new URLSearchParams({
      from: from === 'auto' ? '' : from,   // 注意：auto 传空字符串，不是 'auto'
      to,
      'api-version': '3.0',
      textType: 'html',
    });
    const resp = await fetch(`${TRANS_ENDPOINT}?${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify(texts.map(Text => ({ Text }))),   // 原生支持批量
    });
    if (!resp.ok) {
      if (resp.status === 401) cachedJwt = null;   // 令牌失效，下次重取
      throw new EngineError('bing-edge', true, `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    return {
      translations: data.map((d: any) => d.translations[0].text),
      detectedFrom: data[0]?.detectedLanguage?.language,
    };
  },
};
```

### `src/engines/router.ts`

```typescript
const REGISTRY: Record<string, TranslateEngine> = {
  'google-web': googleWeb,
  'bing-edge':  bingEdge,
  // 阶段 7 追加 openai / deepl / gemini
};

/** 按设置的优先级依次尝试，retryable 失败才切下一个 */
export async function route(req: TranslateRequest): Promise<TranslateResponse> {
  const { enginePriority } = getSettings();
  const errors: EngineError[] = [];

  for (const id of enginePriority) {
    const engine = REGISTRY[id];
    if (!engine) continue;
    if (engine.supportedLangs !== 'all' && !engine.supportedLangs.includes(req.to)) continue;

    try {
      return await engine.translate(req);
    } catch (e) {
      const err = e instanceof EngineError ? e : new EngineError(id, true, String(e));
      errors.push(err);
      if (!err.retryable) throw err;   // 不可切换的失败，直接抛
    }
  }
  throw new Error(`所有引擎均失败: ${errors.map(e => `${e.engineId}(${e.message})`).join(', ')}`);
}
```

### `src/queue/concurrency.ts`

```typescript
/** 限制同时在飞的请求数，避免瞬间打爆端点触发限流 */
export function createGate(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>(r => waiting.push(r));
    active++;
    try { return await task(); }
    finally { active--; waiting.shift()?.(); }
  };
}
```

### `entrypoints/background.ts`

```typescript
export default defineBackground(() => {
  // 工具栏点击 → 通知当前标签页的 content script
  chrome.action.onClicked.addListener(tab => {
    if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'pt:toggle-translate' });
  });

  // content script 无法直接 fetch 跨域端点，统一在此代理
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'pt:translate') return;
    route(msg.payload)
      .then(r => sendResponse({ ok: true, data: r }))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;   // 必须返回 true 保持通道开启，否则 sendResponse 失效
  });
});
```

### `src/dom/collect.ts`（阶段 2 简版）

```typescript
/** 阶段 2 只处理 document 层的块级元素，阶段 3 升级为 shadow 穿透版 */
const DIRECT = 'h1,h2,h3,h4,h5,h6,p,li,dd,blockquote,figcaption';

export function collectSimple(root: ParentNode = document): Element[] {
  return [...root.querySelectorAll(DIRECT)].filter(el => {
    if (el.closest('[data-pt="done"]')) return false;
    const t = el.textContent?.trim() ?? '';
    return t.length >= 3 && t.length <= 3072;
  });
}
```

## 实现要点与取舍

**fetch 必须在 background，不能在 content script。** content script 运行在页面的 origin 下，跨域请求受页面 CSP 与 CORS 双重限制。background service worker 是扩展 origin，不受宿主页面 CSP 约束。这两个端点响应头带 `Access-Control-Allow-Origin: *`，因此**连 `host_permissions` 都不用声明** —— 保持权限清单极简对商店审核是实打实的好处。

**`onMessage` 里异步响应必须 `return true`。** 这是 MV3 最高频的踩坑点：不返回 `true`，消息通道会在回调结束时立即关闭，`sendResponse` 静默失效，表现为 content script 永远等不到响应。

**两个引擎的批量能力不对等，接口必须统一。** Google 端点单次只吃一段文本，Bing 原生支持数组。接口统一收 `texts: string[]`，Google 内部用 `Promise.all` 拆成多请求。**上层不该关心这个差异** —— 否则每加一个引擎，调用方都要改。

**`retryable` 是故障切换的核心。** 网络错误、限流、端点变更都是"换个引擎可能成功"，应当继续尝试；"该引擎不支持目标语言"换了也没用，直接抛。不区分这两类，要么该切的时候不切，要么无意义地把所有引擎试一遍。

**Bing 的 `from` 参数：auto 要传空字符串。** 传字面量 `'auto'` 会被当作无效语言码报错。这个行为在响应里看不出原因，容易卡很久。

**JWT 要缓存并解析 `exp`。** 有效期约 10 分钟。每次翻译都重新取一次令牌，等于把请求量翻倍且明显变慢。同时 401 要清空缓存令牌，让下次自动重取。

**并发闸门默认 6。** 翻译一个长页面会产生上百个请求，无限制并发会立刻触发端点限流（表现为大量 429 或直接被断连）。6 是浏览器对单域名并发连接数的常见上限，与之对齐。

**`collect.ts` 和 `inject.ts` 是刻意的简版。** 阶段 2 的目标是打通链路，不是做全 DOM 覆盖。用 `querySelectorAll` 三十行搞定，阶段 3 再替换成完整 walker。**先让链路跑通，再让覆盖变全** —— 反过来会导致调试时无法区分是采集问题还是链路问题。

## DoD 验收标准

- [ ] Wikipedia 英文页点击工具栏图标，段落下方出现中文译文
- [ ] 再次点击，译文消失（还原原文）
- [ ] 引擎优先级设为 `['bing-edge', 'google-web']` 后重新翻译，走 Bing
- [ ] 屏蔽 `translate.googleapis.com` 后翻译仍成功（自动切 Bing），用户侧无感知
- [ ] 两个引擎均不可用时，界面给出可读的错误提示，而非静默失败
- [ ] 同一页面二次翻译命中缓存，Network 面板无新请求
- [ ] 并发请求数不超过 6（Network 面板观察同时 pending 的请求）
- [ ] `manifest.json` 中仍**无 `host_permissions`**

## 验证步骤

```bash
pnpm dev
```

**基础链路**：打开 `https://en.wikipedia.org/wiki/Translation` → 点工具栏图标 → 段落下方应出现中文译文。

**故障切换**：
1. F12 → Network 面板 → 右键 `translate.googleapis.com` 的任一请求 → 「Block request domain」
2. 刷新页面，重新翻译
3. 预期：翻译照常完成，Network 中出现 `edge.microsoft.com/translate/auth` 与 `api-edge.cognitive.microsofttranslator.com` 请求

**引擎优先级**（popup DevTools Console）：

```javascript
await patchSettings({ enginePriority: ['bing-edge', 'google-web'] });
```
刷新页面重新翻译，Network 中应只见 Bing 请求。

**缓存命中**：翻译完成后刷新页面再翻一次 → Network 面板不应出现翻译请求。

**并发上限**：翻译一个长页面（如 Wikipedia 的 Translation 条目），Network 面板按 Waterfall 观察，同时 pending 的翻译请求不应超过 6 条。

**全引擎失败**：同时屏蔽 `translate.googleapis.com` 与 `edge.microsoft.com` → 翻译应给出明确错误提示，且页面不崩、原文不受损。

**权限自查**：

```bash
grep -n "host_permissions" .output/chrome-mv3-dev/manifest.json
```
预期输出为空。
