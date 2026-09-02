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
    version: '2.0.66',
    groups: [
      {
        type: 'feature',
        items: [
          {
            title: {
              zh_CN: '更新提示',
              zh_TW: '更新提示',
              en: 'Release notes',
            },
            desc: {
              zh_CN:
                '扩展更新后，下次打开网页时会告诉你这一版改了什么。看过一次就不再出现，站点名单里禁用翻译的网站上也不会弹。',
              zh_TW:
                '擴充功能更新後，下次開啟網頁時會告訴你這一版改了什麼。看過一次就不再出現，網站名單裡停用翻譯的網站上也不會彈出。',
              en:
                'After an update, the next page you open tells you what changed. It shows once and never again, and never on sites where translation is disabled.',
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
