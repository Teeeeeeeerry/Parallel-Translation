# 实测：真实页面上内容识别给出的目标语言占比（#851）

测量日期：2026-10-12。用途：给页面级闸门的内容识别阈值 `CONTENT_SHARE_THRESHOLD`（当前 65，#843 按三份自造夹具定的）补上真实页面的依据，供 #858 复核。本票不改产品代码。

## 1. 取样口径

与产品整页翻译时闸门的取样逐步相同，直接用产品自己的代码，不另写一套：

1. 采集：`src/dom/walker.ts` 的 `collect(document.body, undefined, { readOnly: true })`，即闸门取样用的只读模式（不切块、不登记隐藏单元），站点页面规则照常生效。
2. 单元文字：`src/dom/text.ts` 的 `unitTextEx(el, { shallow: hasBlockTextChildren(el) })`，与 `entrypoints/content.ts` 的 `buildPageItems` 相同。
3. 取样：`src/orchestration/page-gate.ts` 的 `sampleUnitTexts`，在全部翻译单元里等距取，总长上限 4000 字符。
4. 识别：把样本原样交给扩展 service worker 里的 `chrome.i18n.detectLanguage`，记下 `isReliable` 与 `languages` 原样。
5. 目标语言占比：与 `contentLanguage` 同一算法，`languages` 里主段为 `zh` 的各项占比相加。目标语言为 zh-CN。

环境：Playwright 自带的 Chromium 151.0.7922.34，界面语言 zh-CN（`Accept-Language: zh-CN`），加载本仓库构建的扩展（2.1.99）。页面打开后等 7 秒、不滚动，模拟“打开页面就点整页翻译”。

复核方法：用 esbuild 把上面三个函数打成一段 IIFE，在页面里求值拿到样本，再在 service worker 里调识别。脚本只放在本机临时目录，没有进仓库。

识别器给出的占比按字节算，一个汉字算三份，各项相加通常不到 100（余下的是识别器认不出的部分，如数字、网址、表情）。

同一张表测了两遍（相隔约 5 分钟）。动态内容会变（YouTube 的推荐栏、Amazon 的配送地区、Steam 的新闻），所以两遍的数可能不同；`isReliable` 也会在两遍之间翻转。

## 2. 样本页面与数据

“应有结论”按页面主体内容判断：主体是成块外文的应照常翻译；主体是中文、只夹零星外文的应拦下。“现行结论”按 #843 的判定链算：识别可靠时只看占比是否到 65；不可靠时回落到语言声明。两遍结论不同时都列出。

### 2.1 界面是目标语言、内容是外文（应照常翻译）

| 站点 | 页面 | 声明 | 单元数 | 样本字符 | 第一遍：分布 / 可靠 | 第二遍：分布 / 可靠 | 现行结论 |
|---|---|---|---|---|---|---|---|
| Steam（英文介绍） | [Path of Exile 2](https://store.steampowered.com/app/2694490/Path_of_Exile_2/?l=schinese) | zh-cn | 128 | 3257 | en 52 zh 41 / 可靠 | en 69 zh 28 / 可靠 | 翻译 |
| Steam（英文介绍） | [Lethal Company](https://store.steampowered.com/app/1966720/Lethal_Company/?l=schinese) | zh-cn | 100 | 3208 | zh 53 en 42 / 可靠 | zh 53 en 42 / 可靠 | 翻译 |
| Steam（英文介绍） | [ULTRAKILL](https://store.steampowered.com/app/1229490/ULTRAKILL/?l=schinese) | zh-cn | 155 | 4000 | zh 58 en 35 / 不可靠 | zh 59 en 33 / 可靠 | **拦下** / 翻译 |
| YouTube（中文界面） | [But what is a neural network?](https://www.youtube.com/watch?v=aircAruvnKk&hl=zh-CN) | zh-Hans-CN | 75 | 2320 | en 67 zh 28 / 可靠 | en 74 zh 17 / 不可靠 | 翻译 / **拦下** |
| YouTube（中文界面） | [Intro to Large Language Models](https://www.youtube.com/watch?v=zjkBMFhNj_g&hl=zh-CN) | zh-Hans-CN | 85 | 1750 | en 39 zh 29 sn 12 / 不可靠 | en 57 zh 16 sn 12 / 不可靠 | **拦下** |
| YouTube（中文界面） | [Never Gonna Give You Up](https://www.youtube.com/watch?v=dQw4w9WgXcQ&hl=zh-CN) | zh-Hans-CN | 69 | 1912 | zh 64 en 20 / 不可靠 | zh 42 en 36 / 不可靠 | **拦下** |
| Cursor 论坛（Discourse，中文界面） | [话题列表](https://forum.cursor.com/latest) | zh-CN | 81 | 620 | zh 33 lb 18 en 9 / 不可靠 | zh 35 lb 18 en 9 / 不可靠 | **拦下** |
| Cursor 论坛 | [话题 174381](https://forum.cursor.com/t/had-auto-after-exceeding-quota-any-way-to-use-after-100/174381) | zh-CN | 25 | 738 | en 76 zh 16 / 可靠 | 同左 | 翻译 |
| Cursor 论坛 | [话题 174380](https://forum.cursor.com/t/slow-quit-20-23s-saving-ui-state-caused-by-enopro-filesystem-provider-race-on-close/174380) | zh-CN | 48 | 2788 | en 92 zh 5 / 可靠 | 同左 | 翻译 |
| Amazon（中文界面） | [MacBook Pro](https://www.amazon.com/dp/B0BSHF7WHW?language=zh_CN) | zh-cn | 394 | 4000 | en 51 zh 39 / 不可靠 | 同左 | **拦下** |
| Amazon（中文界面） | [AirPods Pro 2](https://www.amazon.com/dp/B0CHWRXH8B?language=zh_CN) | zh-cn | 430 | 4000 | en 87 zh 8 / 可靠 | en 76 es 14 zh 8 / 可靠 | 翻译 |
| App Store（中文界面，英文评论） | [Notion](https://apps.apple.com/us/app/notion-notes-tasks-ai/id1232780281?l=zh-Hans-CN) | zh-Hans-CN | 105 | 4000 | en 52 zh 43 / 可靠 | 同左 | 翻译 |
| App Store（中文界面，英文评论） | [Duolingo](https://apps.apple.com/us/app/duolingo-language-lessons/id570060128?l=zh-Hans-CN) | zh-Hans-CN | 121 | 2461 | en 49 zh 41 / 可靠 | 同左 | 翻译 |

Reddit 没有量到：无头浏览器打开任何 Reddit 页面都只拿到一张“You've been blocked by network security”拦截页（3 个单元，en 100）。论坛这一类由 Cursor 论坛顶上，它是 Discourse，按 `Accept-Language` 显示中文界面，话题内容是英文，形状与 Reddit 中文界面相同。

### 2.2 声明是外文、内容其实是目标语言（应拦下）

| 站点 | 页面 | 声明 | 单元数 | 样本字符 | 分布 / 可靠（两遍相同） | 现行结论 |
|---|---|---|---|---|---|---|
| GitHub（中文 README） | [ruanyf/weekly](https://github.com/ruanyf/weekly) | en | 456 | 4000 | zh 94 en 1 / 可靠 | 拦下 |
| GitHub（中文 README） | [justjavac/free-programming-books-zh_CN](https://github.com/justjavac/free-programming-books-zh_CN) | en | 671 | 3899 | zh 64 en 9 / 可靠 | **翻译** |
| GitHub（中文 README） | [jobbole/awesome-python-cn](https://github.com/jobbole/awesome-python-cn) | en | 1131 | 3945 | zh 69 ky 4 en 2 / 不可靠 | **翻译** |
| Rust 程序设计语言中文版（mdBook） | [什么是所有权](https://kaisery.github.io/trpl-zh-cn/ch04-01-what-is-ownership.html) | en | 102 | 4000 | zh 95 / 可靠 | 拦下 |
| Rust 程序设计语言中文版（mdBook） | [字符串](https://kaisery.github.io/trpl-zh-cn/ch08-02-strings.html) | en | 76 | 3876 | zh 88 / 可靠 | 拦下 |
| 若依文档（VuePress） | [首页](https://doc.ruoyi.vip/ruoyi/) | en-US | 29 | 1294 | zh 56 en 14 ja 10 / 可靠 | **翻译** |
| 若依文档（VuePress） | [环境部署](https://doc.ruoyi.vip/ruoyi/document/hjbs.html) | en-US | 25 | 1296 | zh 70 cy 6 en 2 / 不可靠 | **翻译** |

justjavac 与若依首页是“中文页面夹大量英文书名、版本号、网址”的形状，正是 #858 票面说的“零星外文不能把页面判成外文”那一类。

### 2.3 对照：声明与内容都是目标语言（应拦下）

| 站点 | 页面 | 声明 | 第一遍 | 第二遍 | 现行结论 |
|---|---|---|---|---|---|
| Steam（已有中文介绍） | [饥荒联机版](https://store.steampowered.com/app/322330/Dont_Starve_Together/?l=schinese) | zh-cn | zh 82 / 可靠 | 同左 | 拦下 |
| Steam（已有中文介绍） | [Dwarf Fortress](https://store.steampowered.com/app/975370/Dwarf_Fortress/?l=schinese) | zh-cn | zh 74 en 17 / 可靠 | zh 80 en 12 / 可靠 | 拦下 |
| Steam（已有中文介绍） | [Caves of Qud](https://store.steampowered.com/app/333640/Caves_of_Qud/?l=schinese) | zh-cn | zh 80 en 9 / 不可靠 | zh 81 en 10 / 不可靠 | 拦下 |
| Steam（已有中文介绍） | [火线迈阿密](https://store.steampowered.com/app/219150/Hotline_Miami/?l=schinese) | zh-cn | zh 65 en 26 / 不可靠 | 同左 | 拦下 |
| Steam（已有中文介绍） | [Bastion](https://store.steampowered.com/app/107100/Bastion/?l=schinese) | zh-cn | zh 68 en 18 / 不可靠 | 同左 | 拦下 |
| Steam（已有中文介绍） | [邪恶冥刻](https://store.steampowered.com/app/1092790/Inscryption/?l=schinese) | zh-cn | zh 72 en 13 / 不可靠 | 同左 | 拦下 |
| 中文维基 | [长城](https://zh.wikipedia.org/wiki/%E9%95%BF%E5%9F%8E) | zh-Hans-CN | zh 99 / 不可靠 | zh 99 / 可靠 | 拦下 |
| 中文维基 | [人工智能](https://zh.wikipedia.org/wiki/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD) | zh-Hans-CN | zh 94 / 可靠 | zh 95 / 可靠 | 拦下 |
| 少数派 | [首页](https://sspai.com/) | zh-CN | zh 85 / 可靠 | zh 86 / 可靠 | 拦下 |
| V2EX | [首页](https://www.v2ex.com/) | zh-CN | zh 63 / 不可靠 | zh 64 en 5 / 可靠 | 拦下 / **翻译** |
| 阮一峰的网络日志 | [首页](https://www.ruanyifeng.com/blog/) | zh-CN | zh 83 / 不可靠 | 同左 | 拦下 |

“已有中文介绍”的 Steam 页上，英文的部分是开发者新闻、媒体评语、版权声明与配置需求，介绍正文是中文。Dwarf Fortress 与 Caves of Qud 的游戏本体不支持中文（页面上写着“本产品尚未对您目前所在的地区语言提供支持”），但商店介绍已经本地化。

## 3. 汇总

| 类别 | 页数 | 目标语言占比（两遍合并） | 只看识别器报可靠的样本 |
|---|---|---|---|
| 2.1 内容是外文（应翻译） | 13 | 5 到 64 | 5 到 59 |
| 2.2 声明外文、内容中文（应拦下） | 7 | 56 到 95 | 56 到 95 |
| 2.3 对照（应拦下） | 11 | 63 到 99 | 64 到 99 |

- 两类在占比上交叉：外文页最高 64（不可靠）与 59（可靠），目标语言页最低 56（可靠）。没有任何一个占比阈值能把可靠样本完全分开。
- 65 落在目标语言页那一侧之内：可靠的目标语言页里，若依首页 56、justjavac 64（两遍都是）、V2EX 64（第二遍）落在 65 以下，被判成照常翻译，离 65 分别差 9、1、1 个点。可靠的外文页最高 59（ULTRAKILL 第二遍），离 65 只有 6 个点。
- 识别器的可靠标记靠不住：31 个有效页面里第一遍 14 个报不可靠，第二遍 12 个；同一页两遍之间翻转的有 4 个（ULTRAKILL、YouTube 神经网络、中文维基长城、V2EX）。报不可靠时回落到语言声明：外文页的声明都是 zh，于是被拦下 —— 两遍各有 5 张外文页因此被拦（第一遍：ULTRAKILL、两张 YouTube、Cursor 话题列表、Amazon MacBook；第二遍：三张 YouTube、Cursor 话题列表、Amazon MacBook）。这正是 #831 要治的“中文界面、外文内容整页被拦”，在真实页面上 13 张外文页里仍有 5 张命中。
- 占比按字节算放大了中文界面：Steam 页上中文的菜单、标签、评测摘要一个字算三份，外文介绍再长也很难让中文的占比降到 50 以下。
- 现行判定在 31 张页面上两遍分别错 9 张与 10 张：外文页被拦 5 张，目标语言页被翻 4 到 5 张。后者有单元级兜底（#783）接住，代价是多花请求与配额；前者是用户想翻的页面翻不了。

## 4. 结论

65 这个阈值在实测数据上站不住：两类真实页面的目标语言占比交叉（外文页 5 到 64、目标语言页 56 到 99），单一占比阈值分不开，换成别的数只是把错判挪到另一侧。另外识别器在长样本上频繁报不可靠，回落到声明后中文界面的外文页仍被整页拦下，这一条与阈值取多少无关。后续处置见 #858。
