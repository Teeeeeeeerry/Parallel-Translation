// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 更新提示的变更数据 —— ADR-0002：此文件即上架版本的唯一真相。
//
// 这里写了条目的版本号就是「上架版本」，扩展更新到该版本后会向用户
// 弹出更新提示；没写条目的版本是「内部版本」（每个 issue 修复 PR 都会
// bump package.json 末位），静默升级、不打扰用户。
//
// 新增一条的时机：准备上架前，把 package.json 版本定到上架版本号，
// 再在 CHANGELOG 顶部加一条同版本号的条目。两者字面不等时
// `pnpm zip` 会直接失败（scripts/check-changelog.ts），不靠人工把关。

export type LocaleId = 'zh_CN' | 'zh_TW' | 'en';

/**
 * 三语文案。changelog 是结构化数据而非 UI 文案，故不进 _locales ——
 * 扁平 key-value 表达不了「分组 → 条目」的结构，且历史版本的 key
 * 会永久淤积在 messages.json 里。
 */
export type I18nText = Record<LocaleId, string>;

/** 变更分组。渲染顺序固定为 feature → improve → fix。 */
export type ChangeType = 'feature' | 'improve' | 'fix';

export interface ChangeItem {
  title: I18nText;
  desc: I18nText;
}

export interface ChangeGroup {
  type: ChangeType;
  items: ChangeItem[];
}

export interface ChangelogEntry {
  /** 上架版本号，须与 manifest.version 字面相等 */
  version: string;
  groups: ChangeGroup[];
}

/** 分组渲染顺序 —— 新功能在前，修复在后。 */
export const GROUP_ORDER: readonly ChangeType[] = ['feature', 'improve', 'fix'];

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: '2.1.1',
    groups: [
      {
        type: 'feature',
        items: [
          {
            title: {
              zh_CN: '翻译领域与术语',
              zh_TW: '翻譯領域與術語',
              en: 'Domains and glossaries',
            },
            desc: {
              zh_CN: '按领域管理术语：指定某个词怎么译、哪些词不译，领域按网址自动生效。内置领域可以改，术语能用表格编辑，也能导入、导出 CSV。工具栏面板可以把当前标签页临时切到别的领域，或者勾选“以后在此站点都使用”。',
              zh_TW: '依領域管理術語：指定某個詞怎麼譯、哪些詞不譯，領域依網址自動生效。內建領域可以改，術語能用表格編輯，也能匯入、匯出 CSV。工具列面板可以把目前分頁暫時切到別的領域，或者勾選「以後在此網站都使用」。',
              en: 'Manage terms by domain: set how a word is translated, or keep it untranslated, and let the domain apply by URL. Built-in domains are editable, terms have a table editor, and glossaries import and export as CSV. From the toolbar panel you can switch the current tab to another domain, or tick "Always use on this site".',
            },
          },
          {
            title: {
              zh_CN: '站点页面规则',
              zh_TW: '網站頁面規則',
              en: 'Site rules',
            },
            desc: {
              zh_CN: '设置页新增“站点规则”：按网站指定哪些区域不翻、哪些文字保留原文、只翻译哪一块，也可以停用该站点的内置规则。规则能导入 JSON 文件。',
              zh_TW: '設定頁新增「網站規則」：依網站指定哪些區域不翻、哪些文字保留原文、只翻譯哪一塊，也可以停用該網站的內建規則。規則能匯入 JSON 檔。',
              en: "A new \"Site rules\" section lets you choose, per site, which areas to skip, which text to keep in the original, and which part alone to translate. You can also turn off a site's built-in rules, and import rules from a JSON file.",
            },
          },
          {
            title: {
              zh_CN: '新增 DeepSeek 与 Grok',
              zh_TW: '新增 DeepSeek 與 Grok',
              en: 'DeepSeek and Grok',
            },
            desc: {
              zh_CN: '自带 API key 即可使用。两者的网络访问权限不在安装时申请，只在你填好 key、点“测试连接”时由浏览器询问；不同意就不保存 key。',
              zh_TW: '自備 API 金鑰即可使用。兩者的網路存取權限不在安裝時申請，只在你填好金鑰、按「測試連線」時由瀏覽器詢問；不同意就不儲存金鑰。',
              en: "Bring your own API key. Their network access isn't requested at install time; the browser asks only when you enter a key and click \"Test connection\". Decline and the key isn't saved.",
            },
          },
        ],
      },
      {
        type: 'improve',
        items: [
          {
            title: {
              zh_CN: '术语在各引擎里都管用',
              zh_TW: '術語在各引擎裡都管用',
              en: 'Glossaries work across engines',
            },
            desc: {
              zh_CN: 'Google、Bing、DeepL 遇到“不翻译”的词会原样保留；OpenAI、Gemini 等大模型引擎会收到本段命中的术语表。几千条术语也不拖慢翻译和设置页。',
              zh_TW: 'Google、Bing、DeepL 遇到「不翻譯」的詞會原樣保留；OpenAI、Gemini 等大型模型引擎會收到本段命中的術語表。幾千條術語也不拖慢翻譯和設定頁。',
              en: 'Google, Bing and DeepL leave "do not translate" terms as they are, and LLM engines such as OpenAI and Gemini receive the terms found in each passage. Thousands of terms no longer slow down translation or the settings page.',
            },
          },
          {
            title: {
              zh_CN: '译文更干净',
              zh_TW: '譯文更乾淨',
              en: 'Cleaner translations',
            },
            desc: {
              zh_CN: '读屏专用的隐藏文字、没展开的提示不再混进译文；只包着一个链接的说明文字也能翻译。GitHub 的贡献图、文件列表等不再被翻乱。',
              zh_TW: '讀螢幕專用的隱藏文字、沒展開的提示不再混進譯文；只包著一個連結的說明文字也能翻譯。GitHub 的貢獻圖、檔案列表等不再被翻亂。',
              en: "Screen-reader-only text and unopened tooltips no longer leak into translations, and captions that wrap a single link now get translated. GitHub's contribution graph and file list stay intact.",
            },
          },
          {
            title: {
              zh_CN: '设置页新外观',
              zh_TW: '設定頁新外觀',
              en: 'Refreshed settings page',
            },
            desc: {
              zh_CN: '侧栏改为浮起的圆角卡片并固定在视口内，内容区更宽，顶部换上与工具栏面板一致的标识。',
              zh_TW: '側欄改為浮起的圓角卡片並固定在視窗內，內容區更寬，頂部換上與工具列面板一致的標誌。',
              en: 'The sidebar is now a floating rounded card that stays in view, the content area is wider, and the header uses the same logo as the toolbar panel.',
            },
          },
          {
            title: {
              zh_CN: '权限说明更新',
              zh_TW: '權限說明更新',
              en: 'Permissions update',
            },
            desc: {
              zh_CN: '新增“无限存储”权限，术语多时不会因本地空间不足而保存失败，数据仍只在本机。翻译缓存按总大小限额，满了先清最旧的。',
              zh_TW: '新增「無限儲存」權限，術語多時不會因本機空間不足而儲存失敗，資料仍只在本機。翻譯快取依總大小限額，滿了先清最舊的。',
              en: 'Adds the "unlimited storage" permission so large glossaries never fail to save for lack of local space. Data still stays on your device. The translation cache is capped by total size and drops the oldest entries first.',
            },
          },
        ],
      },
      {
        type: 'fix',
        items: [
          {
            title: {
              zh_CN: '部分失败不再前功尽弃',
              zh_TW: '部分失敗不再前功盡棄',
              en: 'Partial failures keep progress',
            },
            desc: {
              zh_CN: '引擎中途出错时，已经翻好的段落会保留，失败的段落单独标出，并提示真实原因。',
              zh_TW: '引擎中途出錯時，已經翻好的段落會保留，失敗的段落單獨標出，並提示真實原因。',
              en: 'When an engine fails midway, paragraphs already translated stay put, failed ones are marked, and you see the real reason.',
            },
          },
          {
            title: {
              zh_CN: 'Firefox 导出不再失败',
              zh_TW: 'Firefox 匯出不再失敗',
              en: 'Firefox exports fixed',
            },
            desc: {
              zh_CN: '导出配置与术语 CSV 在 Firefox 上可能下载失败，现在正常。导出的 CSV 用表格软件打开也不会被当成公式。',
              zh_TW: '匯出設定與術語 CSV 在 Firefox 上可能下載失敗，現在正常。匯出的 CSV 用試算表軟體開啟也不會被當成公式。',
              en: 'Exporting settings or glossary CSVs could fail on Firefox; it now works. Exported CSVs are also no longer read as formulas by spreadsheet apps.',
            },
          },
          {
            title: {
              zh_CN: '多开设置页不再丢改动',
              zh_TW: '多開設定頁不再遺失變更',
              en: 'Multiple settings tabs',
            },
            desc: {
              zh_CN: '同时开着几个设置页修改领域或站点规则，改动都会保留；读取存储失败时提示原因，不再用空数据覆盖。',
              zh_TW: '同時開著幾個設定頁修改領域或網站規則，變更都會保留；讀取儲存失敗時提示原因，不再用空資料覆蓋。',
              en: "Edits to domains or site rules made in several settings tabs at once are all kept. If storage can't be read, you're told why instead of having data overwritten with nothing.",
            },
          },
        ],
      },
    ],
  },
  {
    version: '2.0.67',
    groups: [
      {
        type: 'feature',
        items: [
          {
            title: {
              zh_CN: '对照阅读',
              zh_TW: '對照閱讀',
              en: 'Side-by-side reading',
            },
            desc: {
              zh_CN: '原文与译文并排呈现，读外文不必在两个界面之间来回切换。也可以切换成只看译文，或者只翻译某一段。',
              zh_TW: '原文與譯文並排呈現，讀外文不必在兩個介面之間來回切換。也可以切換成只看譯文，或者只翻譯某一段。',
              en: 'The original and the translation sit together, so you never jump between two windows. You can switch to translation-only, or translate just one paragraph.',
            },
          },
          {
            title: {
              zh_CN: '六个触发入口',
              zh_TW: '六個觸發入口',
              en: 'Six ways to start',
            },
            desc: {
              zh_CN: '悬浮球、工具栏图标、快捷键、鼠标悬停逐段翻译、选中文字后右键、按住修饰键拖光标 —— 挑顺手的用。',
              zh_TW: '懸浮球、工具列圖示、快速鍵、滑鼠停留逐段翻譯、選取文字後按右鍵、按住修飾鍵拖曳游標 —— 挑順手的用。',
              en: 'Floating button, toolbar icon, keyboard shortcut, hovering a paragraph, right-clicking a selection, or dragging the cursor with a modifier key. Pick whichever suits you.',
            },
          },
          {
            title: {
              zh_CN: '多引擎与自动切换',
              zh_TW: '多引擎與自動切換',
              en: 'Engines with failover',
            },
            desc: {
              zh_CN: 'Google 与 Bing 免 key 开箱即用；也可自带 API key 接入 OpenAI、DeepL、Gemini。引擎按你排的优先级顺序故障切换，不支持目标语言的自动跳过。',
              zh_TW: 'Google 與 Bing 免金鑰開箱即用；也可自備 API 金鑰接上 OpenAI、DeepL、Gemini。引擎會依你排的優先順序容錯切換，不支援目標語言的會自動略過。',
              en: 'Google and Bing work out of the box with no API key. Bring your own key for OpenAI, DeepL or Gemini. Engines fail over in the order you set, and any that lack your target language are skipped.',
            },
          },
          {
            title: {
              zh_CN: '更新提示',
              zh_TW: '更新提示',
              en: 'Release notes',
            },
            desc: {
              zh_CN: '就是你正在看的这个。扩展更新后，下次打开网页时告诉你改了什么，看过一次就不再出现。',
              zh_TW: '就是你正在看的這個。擴充功能更新後，下次開啟網頁時告訴你改了什麼，看過一次就不再出現。',
              en: 'This panel. After an update, the next page you open tells you what changed. It shows once and never again.',
            },
          },
          {
            title: {
              zh_CN: '汇报问题',
              zh_TW: '回報問題',
              en: 'Report an issue',
            },
            desc: {
              zh_CN: '工具栏面板底部新增入口，点一下直达 GitHub 提问页，不用再自己翻仓库地址。',
              zh_TW: '工具列面板底部新增入口，點一下直達 GitHub 提問頁，不用再自己翻儲存庫網址。',
              en: 'A new button at the bottom of the toolbar panel takes you straight to the GitHub issue form, so you no longer have to hunt down the repository.',
            },
          },
        ],
      },
      {
        type: 'improve',
        items: [
          {
            title: {
              zh_CN: '网页适配',
              zh_TW: '網頁相容性',
              en: 'Page coverage',
            },
            desc: {
              zh_CN: '穿透 shadow DOM 与同源 iframe；无限滚动和单页应用路由切换出的新内容会自动补翻。数字与非正文区域在采集阶段就被滤掉，不消耗翻译额度。',
              zh_TW: '可穿透 shadow DOM 與同源 iframe；無限捲動和單頁應用切換路由後出現的新內容會自動補翻。數字與非內文區域在擷取階段就被濾掉，不消耗翻譯額度。',
              en: 'Reaches into shadow DOM and same-origin iframes. Content from infinite scroll and SPA navigation is translated as it appears. Numbers and non-article areas are filtered out before any request, so they cost you nothing.',
            },
          },
          {
            title: {
              zh_CN: '译文样式可调',
              zh_TW: '譯文樣式可調',
              en: 'Adjustable styling',
            },
            desc: {
              zh_CN: '六种预设样式（弱化显示、下划线、加粗、斜体、左边线等），也可以自己写 CSS。样式只作用于译文，改不动原网页。',
              zh_TW: '六種預設樣式（淡化顯示、底線、粗體、斜體、左邊線等），也可以自己寫 CSS。樣式只作用於譯文，動不了原網頁。',
              en: 'Six presets — dimmed, underlined, bold, italic, left-bordered — plus your own CSS if you want it. Styling touches only the translation, never the page itself.',
            },
          },
          {
            title: {
              zh_CN: '最小权限',
              zh_TW: '最小權限',
              en: 'Minimal permissions',
            },
            desc: {
              zh_CN: '只申请存储与右键菜单两项权限，网络请求仅限你选用的翻译服务端点。不收集任何个人信息，无分析、无埋点。',
              zh_TW: '只申請儲存與右鍵選單兩項權限，網路請求僅限你選用的翻譯服務端點。不蒐集任何個人資訊，無分析、無追蹤。',
              en: 'Only storage and context menus are requested. Network requests go solely to the translation service you picked. No tracking, no analytics, no personal data collected.',
            },
          },
          {
            title: {
              zh_CN: '默认译文样式',
              zh_TW: '預設譯文樣式',
              en: 'Default translation style',
            },
            desc: {
              zh_CN: '默认改为半透明，压低译文存在感、不打断原文的阅读节奏。原先那套黄铜色左边线保留为独立选项「左边线」，排在样式列表末尾，想要的话随时选回来。',
              zh_TW: '預設改為半透明，壓低譯文存在感、不打斷原文的閱讀節奏。原先帶黃銅色邊線的樣式保留為獨立選項「左邊線」，排在樣式清單末尾，想要的話隨時選回來。',
              en: 'The default is now simply translucent, so translations stay out of the way as you read. The old brass left-border look survives as its own option, "Left border", at the bottom of the style list.',
            },
          },
        ],
      },
      {
        type: 'fix',
        items: [
          {
            title: {
              zh_CN: '不再自动冒出译文',
              zh_TW: '不再自動冒出譯文',
              en: 'No more uninvited translations',
            },
            desc: {
              zh_CN: '在单页应用上，网站自己刷新内容时会误触发整页翻译，哪怕你根本没点过翻译。',
              zh_TW: '在單頁應用上，網站自己更新內容時會誤觸發整頁翻譯，哪怕你根本沒點過翻譯。',
              en: 'On single-page apps, the site refreshing its own content could kick off a full-page translation you never asked for.',
            },
          },
          {
            title: {
              zh_CN: '折叠内容不再漏翻',
              zh_TW: '摺疊內容不再漏翻',
              en: 'Collapsed content no longer skipped',
            },
            desc: {
              zh_CN: 'shadow DOM 里初次不可见的内容（折叠区、展开面板）在展开后不会被翻译，现在能正常补上。',
              zh_TW: 'shadow DOM 裡初次不可見的內容（摺疊區、展開面板）在展開後不會被翻譯，現在能正常補上。',
              en: 'Content hidden inside shadow DOM — collapsed sections, expandable panels — stayed untranslated after you opened it. It now fills in properly.',
            },
          },
          {
            title: {
              zh_CN: '导入配置不再残留',
              zh_TW: '匯入設定不再殘留',
              en: 'Clean config import',
            },
            desc: {
              zh_CN: '导入配置文件时，本机原有的自定义模型名会留下来。现在导入即整体替换，没写到的项回到默认值。',
              zh_TW: '匯入設定檔時，本機原有的自訂模型名稱會留下來。現在匯入即整體取代，沒寫到的項目回到預設值。',
              en: 'Importing a config left your old custom model names behind. Import now replaces wholesale, with anything unset falling back to its default.',
            },
          },
        ],
      },
    ],
  },
];

/**
 * 查上架版本的条目。字面相等，不做 semver 范围匹配 ——
 * 「2.1」不命中「2.1.0」，免得版本号少写一位时静默弹出别的版本的内容。
 */
export function findEntry(
  version: string,
  entries: readonly ChangelogEntry[] = CHANGELOG,
): ChangelogEntry | undefined {
  return entries.find((e) => e.version === version);
}
