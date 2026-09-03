# 更新提示走页内模态,首装欢迎页保持独立标签页

扩展更新由浏览器静默完成,往往发生在用户不在场时。若沿用首装欢迎页的做法在 `onInstalled` 里 `chrome.tabs.create`,用户回到浏览器时看到的是一个来历不明的标签页,最容易被顺手关掉。因此更新提示改由 content script 在页面内以 shadow DOM 模态呈现,在 `document_end` 触发 —— 页面刚加载完、用户尚未开始阅读的那一刻,到达率更高而打扰更小。首装场景不同:用户刚点完安装正在等反馈,此时开标签页符合预期,故欢迎页维持原样。

## 备选方案

- **独立标签页** —— 可复用 [entrypoints/welcome/](../../entrypoints/welcome/) 的全套基础设施(HTML 入口、`data-i18n`、`tokens.css`),且 `onInstalled` 只触发一次,没有并发问题。因到达率低而放弃。
- **popup 内展示** —— 最克制,但用户不主动点工具栏图标就永远看不到,与告知变更的目的相悖。

## 影响

- 需要仲裁「只弹一次」:多个标签页的 content script 会并发启动,都会读到未读标记。
- 扩展更新前已打开的旧标签页里 content script 是孤儿(见 [entrypoints/background.ts](../../entrypoints/background.ts) 中 #166 注释),background 无法在更新那一刻主动推送,必须由新 content script 反向拉取。更新提示因此天然延迟到用户下次打开新页面 —— 这是接受的行为而非缺陷。
- content script 体积敏感。弹窗经动态 `import()` 引入,但 MV3 的 content script 打包为 IIFE 单文件,动态 import 并不会分包 —— 代码仍在主 bundle 内(实测 content.js 53.2 kB → 61.3 kB)。保留动态形式是为了推迟执行时机,以及日后 content script 支持 ESM 时能自动分出去。若这 8 kB 成为负担,可改为经 `web_accessible_resources` 注入独立脚本。
- 站点名单中被禁用翻译的站点不弹:用户拉黑一个站点的预期是「这个扩展在这里别出现」,而不只是别翻译。
