/**
 * i18n.ts —— 扩展语言（#1100，父 #1098）单元测试
 *
 * 选了具体语言时，取文改从该语言随扩展打包的 messages.json 取，不管浏览器
 * 界面语言是什么；“跟随浏览器”时仍然直接走 chrome.i18n.getMessage。
 * 只看外部行为：给定所选语言，某个 key 取到什么文案。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  applyI18n,
  loadUiLocale,
  t,
  tf,
  uiLocale,
  type MessageTable,
  type UiLocale,
} from '~/src/i18n';

function readMessages(locale: UiLocale): MessageTable {
  const p = path.resolve('public/_locales', locale, 'messages.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as MessageTable;
}

/** 测试用载入器：读仓库里的 messages.json，与随扩展打包的是同一份。 */
const fromRepo = vi.fn(async (locale: UiLocale) => readMessages(locale));

const message = (locale: UiLocale, key: string) => readMessages(locale)[key]!.message;

beforeEach(() => {
  fromRepo.mockClear();
});

afterEach(async () => {
  await loadUiLocale('browser');
  vi.mocked(chrome.i18n.getUILanguage).mockReturnValue('zh-CN');
});

describe('选了具体语言', () => {
  test('选 en：不论浏览器界面语言是什么都取英文', async () => {
    vi.mocked(chrome.i18n.getUILanguage).mockReturnValue('zh-CN');
    await loadUiLocale('en', fromRepo);
    expect(t('rowFrom')).toBe(message('en', 'rowFrom'));
    vi.mocked(chrome.i18n.getUILanguage).mockReturnValue('ja');
    expect(t('rowFrom')).toBe(message('en', 'rowFrom'));
  });

  test('选 zh_TW：取繁体', async () => {
    vi.mocked(chrome.i18n.getUILanguage).mockReturnValue('en-US');
    await loadUiLocale('zh_TW', fromRepo);
    expect(t('rowFrom')).toBe(message('zh_TW', 'rowFrom'));
    expect(tf('rowEnabled', 'x')).toBe(message('zh_TW', 'rowEnabled'));
  });

  test('不再经过 chrome.i18n.getMessage', async () => {
    await loadUiLocale('en', fromRepo);
    vi.mocked(chrome.i18n.getMessage).mockClear();
    t('rowFrom');
    expect(chrome.i18n.getMessage).not.toHaveBeenCalled();
  });

  test('当前生效界面语言就是所选语言', async () => {
    vi.mocked(chrome.i18n.getUILanguage).mockReturnValue('zh-CN');
    await loadUiLocale('en', fromRepo);
    expect(uiLocale()).toBe('en');
    await loadUiLocale('zh_TW', fromRepo);
    expect(uiLocale()).toBe('zh_TW');
  });
});

describe('占位符：与 chrome.i18n.getMessage 同一套规则', () => {
  test('具名占位符经 content 的 $1 取替换值（testOkUsage）', async () => {
    await loadUiLocale('zh_CN', fromRepo);
    expect(t('testOkUsage', '42')).toBe('连接成功（已用 42 字符）');
  });

  test('具名占位符大小写不敏感：消息里写 $FEATURE$，placeholders 里写 feature', async () => {
    await loadUiLocale('en', fromRepo);
    const raw = readMessages('en').sliderOffNote!;
    const expected = raw.message.replace(/\$FEATURE\$/i, 'Floating ball');
    expect(t('sliderOffNote', 'Floating ball')).toBe(expected);
  });

  test('替换值里的 $1 不会被再替换一次；缺替换值时占位处为空', async () => {
    await loadUiLocale('zh_CN', fromRepo);
    expect(t('testOkUsage', '$1')).toBe('连接成功（已用 $1 字符）');
    expect(t('testOkUsage')).toBe('连接成功（已用  字符）');
  });

  test('$$ 是字面的 $', async () => {
    const table: MessageTable = {
      price: { message: '$$$AMOUNT$', placeholders: { amount: { content: '$1' } } },
    };
    await loadUiLocale('en', async () => table);
    expect(t('price', '5')).toBe('$5');
  });
});

describe('回落', () => {
  test('所选语言缺 key 时回落到 zh_CN', async () => {
    const en = readMessages('en');
    delete en.rowFrom;
    await loadUiLocale('en', async (l) => (l === 'en' ? en : readMessages(l)));
    expect(t('rowFrom')).toBe(message('zh_CN', 'rowFrom'));
    expect(t('rowTo')).toBe(message('en', 'rowTo'));
  });

  test('zh_CN 也没有时返回空，由 tf 的兜底顶上', async () => {
    await loadUiLocale('en', fromRepo);
    expect(t('noSuchKey')).toBe('');
    expect(tf('noSuchKey', '兜底')).toBe('兜底');
  });

  test('载入失败时回到跟随浏览器，界面不空白', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await loadUiLocale('en', async () => {
      throw new Error('offline');
    });
    expect(t('rowFrom')).toBe('rowFrom'); // setup 里的 getMessage 原样返回 key
    error.mockRestore();
  });

  test('先后两次选择，以后一次为准（前一次载入较慢也一样）', async () => {
    let releaseEn!: () => void;
    const slowEn = new Promise<void>((r) => (releaseEn = r));
    const first = loadUiLocale('en', async (l) => {
      await slowEn;
      return readMessages(l);
    });
    await loadUiLocale('zh_TW', fromRepo);
    releaseEn();
    await first;
    expect(uiLocale()).toBe('zh_TW');
    expect(t('rowFrom')).toBe(message('zh_TW', 'rowFrom'));
  });
});

describe('跟随浏览器', () => {
  test('结果就是 chrome.i18n.getMessage 的结果，不载入任何取文表', async () => {
    await loadUiLocale('en', fromRepo);
    fromRepo.mockClear();
    await loadUiLocale('browser', fromRepo);
    expect(fromRepo).not.toHaveBeenCalled();
    vi.mocked(chrome.i18n.getMessage).mockImplementationOnce(() => '来自浏览器');
    expect(t('rowFrom')).toBe('来自浏览器');
  });

  test('当前生效界面语言回到浏览器界面语言', async () => {
    await loadUiLocale('en', fromRepo);
    await loadUiLocale('browser');
    vi.mocked(chrome.i18n.getUILanguage).mockReturnValue('zh-TW');
    expect(uiLocale()).toBe('zh_TW');
  });
});

describe('applyI18n 在所选语言下替换三种属性', () => {
  test('data-i18n / data-i18n-placeholder / data-i18n-title', async () => {
    await loadUiLocale('en', fromRepo);
    document.body.innerHTML = `
      <span data-i18n="rowFrom">源语言</span>
      <input data-i18n-placeholder="rowTo" />
      <button data-i18n-title="rowEnabled"></button>`;
    applyI18n();
    expect(document.querySelector('span')!.textContent).toBe(message('en', 'rowFrom'));
    expect(document.querySelector('input')!.placeholder).toBe(message('en', 'rowTo'));
    expect(document.querySelector('button')!.title).toBe(message('en', 'rowEnabled'));
  });
});
