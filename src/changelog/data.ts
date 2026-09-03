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
