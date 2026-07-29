# 阶段 8 — 兼容补丁、多浏览器与上架

## 目标

为通用 DOM 采集覆盖不到的站点补上域名级补丁，完成 Edge 与 Firefox 适配，准备 Chrome Web Store 上架材料。本阶段结束后项目可提交审核。

## 前置依赖

- 阶段 3：`collect()` 通用采集已实现，补丁作为其兜底层
- 阶段 7：功能完整，可对外发布

## 交付文件清单

```
src/dom/
└── compat.ts              # 域名级采集补丁

public/
├── icon/                  # 16/32/48/128 正式图标
└── _locales/              # 阶段 7 已建，此处补齐商店文案

store/                     # 不打包，仅上架材料
├── privacy-policy.md
├── description-zh.md
├── description-en.md
└── screenshots/           # 1280x800 ×5

wxt.config.ts              # 追加 firefox / edge 构建目标
```

## 关键代码骨架

### `src/dom/compat.ts`

```typescript
type CompatResult =
  | { skip: true }              // 明确不翻此节点
  | { take: Element }           // 改为翻译指定节点
  | null;                       // 无意见，交回通用逻辑

type CompatHandler = (el: Element) => CompatResult;

/**
 * 域名补丁表。仅在通用 walker 判断有误时才添加条目 ——
 * 这是兜底层，不是主路径。每加一条都意味着一处通用逻辑的缺陷。
 */
const HANDLERS: Record<string, CompatHandler> = {
  'youtube.com': el => {
    // 时长、播放量、发布时间等元数据不翻
    if (el.matches('.ytd-thumbnail-overlay-time-status-renderer')) return { skip: true };
    return null;
  },
  'github.com': el => {
    // 代码 diff、文件名、commit hash 不翻
    if (el.closest('.blob-code, .file-info, .commit-tease-sha')) return { skip: true };
    return null;
  },
};

/** 取主域名：news.ycombinator.com → ycombinator.com */
export function mainDomain(host: string): string {
  const parts = host.split('.');
  return parts.length <= 2 ? host : parts.slice(-2).join('.');
}

export function applyCompat(el: Element): CompatResult {
  return HANDLERS[mainDomain(location.hostname)]?.(el) ?? null;
}
```

接入点在 `walker.ts` 的判定链中，位于通用规则之前：

```typescript
const patched = applyCompat(el);
if (patched && 'skip' in patched) continue;
if (patched && 'take' in patched) { out.push(patched.take); continue; }
// 否则走通用 shouldSkip / isTranslationUnit
```

### `wxt.config.ts` 多浏览器

```typescript
export default defineConfig({
  manifest: ({ browser }) => ({
    name: 'Parallel-Translation',
    permissions: ['storage', 'contextMenus'],
    // Firefox 需要显式 id，否则无法上架 AMO
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: { id: 'parallel-translation@example.com', strict_min_version: '109.0' },
      },
    }),
  }),
});
```

```bash
pnpm build              # Chrome
pnpm build -b firefox   # Firefox
pnpm build -b edge      # Edge
```

### `store/privacy-policy.md` 要点

必须如实覆盖以下几条，Chrome Web Store 审核会逐条核对：

- **收集了什么**：不收集任何个人信息，无分析、无埋点、无远程日志
- **数据流向**：用户选中或页面上的待翻译文本会发送至用户所选的翻译服务提供方
- **本地存储**：设置存于浏览器同步存储；翻译缓存与 API 密钥存于本地存储，**密钥不参与云端同步**
- **第三方**：列明所有可能的翻译服务提供方及其隐私政策链接
- **权限用途**：`storage` 用于保存设置与缓存；`contextMenus` 用于提供右键翻译菜单

## 实现要点与取舍

**补丁是兜底层，不是主路径。** 每加一条域名补丁，都说明通用逻辑在某处判断有误。**先问"能不能改进通用规则"，改不动才写补丁。** 反过来做会退化成逐站适配 —— 那意味着每上线一个新站点就要发一次版，永远追不完。

**补丁只做两件事：跳过、改指。** 不要在补丁里写翻译逻辑或 DOM 操作，那会让两套代码路径分叉，后续任何渲染改动都要改两遍。

**取主域名而非完整域名。** `news.ycombinator.com` 与 `ycombinator.com` 应命中同一条补丁。简单取末两段对绝大多数站点够用；`co.uk` 这类多级后缀若真遇到再特判，不值得引入 public suffix list 那种量级的依赖。

**权限清单在上架前必须再核一遍。** 到此阶段只应有 `storage` 与 `contextMenus`，**不应有 `host_permissions`**。目标端点 CORS 全开，不需要。审核方会逐项询问权限用途，少一项就少一处解释。

**Firefox 必须显式声明扩展 id。** 没有 `browser_specific_settings.gecko.id`，AMO 直接拒收。Edge 使用 Chromium 内核，Chrome 的产物基本可直接提交。

**Firefox 的 MV3 支持程度与 Chrome 有差异。** 重点回归三项：background service worker 的生命周期、`chrome.storage.sync` 配额、shadow DOM 隔离表现。这三项在 Firefox 上都有过实现差异。

**隐私政策必须如实描述数据流向。** "待翻译文本会发送至第三方翻译服务"这一条必须写清楚 —— 这是本扩展唯一的数据外发行为，隐瞒会导致下架。同时要写明 API 密钥不参与云端同步。

**截图要展示核心价值。** 5 张：对照模式全貌、仅译文模式、6 种样式对比、设置页、划词翻译。截图是商店页面上用户唯一会认真看的东西。

## DoD 验收标准

- [ ] YouTube 的时长、播放量等元数据不再被翻译
- [ ] GitHub 的代码块、文件名、commit hash 不再被翻译
- [ ] 补丁表为空时，所有站点行为与阶段 3 完全一致（补丁纯增量、不改变默认路径）
- [ ] `pnpm build` / `pnpm build -b firefox` / `pnpm build -b edge` 三个目标均构建成功
- [ ] Firefox 中扩展可加载，核心翻译流程正常
- [ ] Edge 中扩展可加载，核心翻译流程正常
- [ ] 最终 `manifest.json` 中 `permissions` 仅含 `storage` 与 `contextMenus`
- [ ] 最终 `manifest.json` **无 `host_permissions`**
- [ ] 图标四种尺寸齐备，在浅色与深色工具栏下均清晰
- [ ] 隐私政策覆盖上述全部要点
- [ ] 5 张 1280×800 截图就位
- [ ] 全量回归：5 个测试站点 × 6 个入口 × 3 种模式全部通过

## 验证步骤

**补丁生效**：

```bash
pnpm dev
```

打开 YouTube 首页 → 翻译 → 视频时长（如 `12:34`）、播放量（如 `1.2M views`）应保持原样。
打开任一 GitHub PR 的 Files changed → 翻译 → 代码行应保持原样，PR 描述正常翻译。

**补丁纯增量自查**：临时清空 `HANDLERS` 对象 → 重新翻译测试站点 → 行为应与阶段 3 完全一致。

**三目标构建**：

```bash
pnpm build && pnpm build -b firefox && pnpm build -b edge
ls -la .output/
```

**权限终检**：

```bash
cat .output/chrome-mv3/manifest.json | python3 -m json.tool | grep -A5 '"permissions"'
grep -c "host_permissions" .output/chrome-mv3/manifest.json    # 预期 0
```

**Firefox 回归**：
1. 打开 `about:debugging#/runtime/this-firefox`
2. 点「临时载入附加组件」，选 `.output/firefox-mv2/manifest.json`（或 mv3 目录）
3. 回归：全页翻译、模式切换、悬浮球、快捷键、设置持久化

**Edge 回归**：`edge://extensions/` 加载 `.output/chrome-mv3/`，跑同一组回归。

**全量回归矩阵**：

| 站点 | 工具栏 | 悬浮球 | 快捷键 | 悬停按钮 | 右键 | 拖光标 |
|---|---|---|---|---|---|---|
| Wikipedia | | | | | | |
| Reddit | | | | | | |
| YouTube | | | | | | |
| X | | | | | | |
| Medium | | | | | | |

每格再验证对照 / 仅译文 / 单段三种模式。全绿方可提交审核。
