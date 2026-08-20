# 商店截图与宣传图

Chrome Web Store 的截图要求 1280×800（或 640×400）PNG/JPEG，本项目统一用 **1280×800 PNG**。

全部素材由 `capture.mjs` 在真实 Chromium 里加载 `.output/chrome-mv3`、调真实的 Google
免 key 引擎翻译后实拍产出 —— 不是合成图。扩展加载链路与 `docs/testing/e2e/fixtures.ts`
相同（`launchPersistentContext` + `--load-extension`）。

## 重新生成

```bash
pnpm build && pnpm store:shots
```

需要外网：脚本启动时会探一次 `translate.googleapis.com`，不通就直接失败，
不会产出没有译文的空图。

```bash
node store/screenshots/capture.mjs --locale zh   # 只重拍中文套
node store/screenshots/capture.mjs --only 03,04  # 只重拍指定几张
node store/screenshots/capture.mjs --headed      # 显示浏览器窗口，排查用
```

`--only` 接受 `01` `02` `03` `04` `05` `promo`。

## 素材清单

`zh/` 与 `en/` 各一套，共 14 个文件。中文套用英文演示页译成中文，
英文套用西班牙语演示页译成英文 —— 英语读者能直接读懂对照的两层。

| 文件名 | 尺寸 | 内容 |
|---|---|---|
| `01-bilingual.png` | 1280×800 | 对照模式全貌，原文在上译文在下 |
| `02-translation-only.png` | 1280×800 | 仅译文模式，与 01 同一段落构成对比 |
| `03-styles.png` | 1280×800 | 六种译文样式两列三行对比 |
| `04-options.png` | 1280×800 | 设置页引擎分区，同屏展示优先级拖拽与 BYOK 密钥 |
| `05-selection.png` | 1280×800 | 划词翻译，选区加译文 toast |
| `promo-440x280.png` | 440×280 | CWS 小宣传图（可选素材） |
| `promo-1400x560.png` | 1400×560 | CWS 大横幅（仅编辑推荐时使用） |

演示页在 `demo/`，两篇文章均为本项目自有内容，站点名为虚构，不含任何真实品牌、
人名或账号。`styles-grid.html` 与 `promo.html` 是拼图与宣传图模板。

## 上传前复核

脚本保证尺寸、流程与语言，保证不了观感 —— 下面这些仍需逐张过一遍：

- 01/02 的译文真实可读；若出现 `【译】` 前缀说明误装了 `src/engines/e2e-mock.ts`，
  脚本会拦截，但仍应确认
- 03 六格差异肉眼可辨；`dim` 那格没有译文是正确的（该样式悬停才淡入，格子右上角有注解）
- 04 的密钥框只有圆点。脚本写入的是 `sk-demo-not-a-real-key-…`，**任何情况下不要拿真实 key 重拍**
- 05 的 toast 完整、不透明，且译文没有断在半句上
- `en/` 一套的扩展界面应全英文。注意 `ENGINE_LABELS`（`src/storage/schema.ts`）
  目前硬编码中文，英文界面里的引擎名仍显示「Google 翻译」「Bing 翻译」
- 商店 listing 按区域选用对应目录：简中商店用 `zh/`，英文商店用 `en/`

## 实现上的几个坑

改脚本或模板前值得先知道：

- 扩展 UI 语言由浏览器 UI locale 决定，而 macOS 上 Chromium 基本忽略 `--lang`。
  脚本改用 `default_locale` 回退链：把产物复制到 `.output/.screenshot-ext/{zh,en}/`，
  每份只留一个 `_locales` 子目录。原始 `.output/chrome-mv3` 全程只读
- 悬浮球只受 `showFloatingBall` 控制，与 `enabled` 无关 —— 拍宣传图和拼图页时
  两个都要关，否则注入的球会出现在画面里
- 拼图模板的 `.grid` 必须同时有 `min-height: 0` 和 `minmax(0, 1fr)`，
  少一个第三行就会被顶出 800px 画布
- 划词的选区起点必须在视口内，否则浏览器会把页面拽去跟随选区
