/**
 * 扩展语言在网页与后台生效（#1101，父 #1098）
 *
 * 内容脚本不把 _locales 暴露成 web_accessible_resources，也不把三份文案打进
 * 内容脚本包（ADR-0001：内容脚本体积敏感），所选语言的取文表向后台要。
 * 悬浮球、输入翻译圆点这类常驻元素的可读名称随扩展语言更新；右键菜单标题
 * 由后台更新。只看外部行为：给定所选语言，界面上读到什么文案。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  loadMessagesViaBackground,
  loadUiLocale,
  onUiLocaleChange,
  t,
  UI_MESSAGES,
  type MessageTable,
  type UiLocale,
} from '~/src/i18n';
import { answerUiMessages } from '~/src/runtime/ui-messages';
import { refreshContextMenuTitle } from '~/src/ui/context-menu';
import { createBall, setBallState } from '~/src/ui/floating-ball';
import { createInputDot } from '~/src/ui/input-dot';
import { showChangelog } from '~/src/changelog/modal';
import type { ChangelogEntry } from '~/src/changelog/data';

function readMessages(locale: UiLocale): MessageTable {
  const p = path.resolve('public/_locales', locale, 'messages.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as MessageTable;
}
const fromRepo = async (locale: UiLocale) => readMessages(locale);
const message = (locale: UiLocale, key: string) => readMessages(locale)[key]!.message;

/** 把内容脚本发出的 pt:ui-messages 交给后台的应答函数，模拟一来一回。 */
function wireBackground(): void {
  vi.mocked(chrome.runtime.sendMessage).mockImplementation((async (msg: unknown) =>
    answerUiMessages(msg, fromRepo)) as never);
}

afterEach(async () => {
  await loadUiLocale('browser');
  vi.mocked(chrome.i18n.getUILanguage).mockReturnValue('zh-CN');
  vi.mocked(chrome.runtime.sendMessage).mockReset().mockResolvedValue(undefined as never);
  document.body.innerHTML = '';
});

describe('后台按请求返回所选语言的取文表', () => {
  test('三种界面语言各返回自己的表', async () => {
    for (const locale of ['en', 'zh_CN', 'zh_TW'] as const) {
      const r = await answerUiMessages({ type: UI_MESSAGES, locale }, fromRepo);
      expect(r).toEqual({ ok: true, table: readMessages(locale) });
    }
  });

  test('不是这条消息，或语言不在三种之内：不应答', async () => {
    expect(await answerUiMessages({ type: 'pt:ping' }, fromRepo)).toBeUndefined();
    for (const locale of ['ja', '../secret', '', undefined]) {
      expect(await answerUiMessages({ type: UI_MESSAGES, locale }, fromRepo)).toEqual({
        ok: false,
      });
    }
  });

  test('缺省从扩展包里取：同一语言只读一次，读失败的下次重读', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockImplementation(async () => new Response(JSON.stringify(readMessages('zh_TW'))));
    const ask = () => answerUiMessages({ type: UI_MESSAGES, locale: 'zh_TW' });
    expect(await ask()).toEqual({ ok: false });
    expect(await ask()).toEqual({ ok: true, table: readMessages('zh_TW') });
    expect(await ask()).toEqual({ ok: true, table: readMessages('zh_TW') });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith('chrome-extension://mock/_locales/zh_TW/messages.json');
    fetchMock.mockRestore();
    error.mockRestore();
  });

  test('载入失败时如实报失败', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await answerUiMessages({ type: UI_MESSAGES, locale: 'en' }, async () => {
      throw new Error('boom');
    });
    expect(r).toEqual({ ok: false });
    error.mockRestore();
  });
});

describe('内容脚本经后台载入取文表', () => {
  test('选 en：网页上的文案取英文，与浏览器界面语言无关', async () => {
    wireBackground();
    await loadUiLocale('en', loadMessagesViaBackground);
    expect(t('translate')).toBe(message('en', 'translate'));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: UI_MESSAGES, locale: 'en' });
  });

  test('跟随浏览器：一条消息都不发', async () => {
    wireBackground();
    await loadUiLocale('browser', loadMessagesViaBackground);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('后台没应答（扩展上下文失效等）：回到跟随浏览器，不空白', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: false } as never);
    await loadUiLocale('en', loadMessagesViaBackground);
    expect(t('translate')).toBe('translate'); // setup 的 getMessage 原样返回 key
    error.mockRestore();
  });

  test('设置变了换表：之后取到的是新语言', async () => {
    wireBackground();
    await loadUiLocale('en', loadMessagesViaBackground);
    await loadUiLocale('zh_TW', loadMessagesViaBackground);
    expect(t('translate')).toBe(message('zh_TW', 'translate'));
  });
});

describe('常驻元素的可读名称随扩展语言更新', () => {
  const shadowOf = (id: string) => document.getElementById(`pt-host-${id}`)!.shadowRoot!;

  test('悬浮球的可读名称与字形', async () => {
    const stop = createBall({ onToggle: () => {} });
    const ball = shadowOf('ball').querySelector<HTMLElement>('.pt-ball')!;
    await loadUiLocale('en', fromRepo);
    expect(ball.getAttribute('aria-label')).toBe(message('en', 'translate'));
    expect(ball.textContent).toBe(message('en', 'ballGlyph'));
    await loadUiLocale('zh_TW', fromRepo);
    expect(ball.getAttribute('aria-label')).toBe(message('zh_TW', 'translate'));
    stop();
  });

  test('输入翻译圆点的可读名称', async () => {
    const stop = createInputDot({ translate: async () => {} });
    const dot = shadowOf('input-dot').querySelector<HTMLElement>('.pt-input-dot')!;
    await loadUiLocale('en', fromRepo);
    expect(dot.getAttribute('aria-label')).toBe(message('en', 'inputDotLabel'));
    stop();
  });

  test('悬浮球处在错误态时换语言：字形换掉，错误态照常自动回到 idle', async () => {
    vi.useFakeTimers();
    const stop = createBall({ onToggle: () => {} });
    const ball = shadowOf('ball').querySelector<HTMLElement>('.pt-ball')!;
    setBallState('error');
    await vi.advanceTimersByTimeAsync(2000);
    await loadUiLocale('en', fromRepo);
    expect(ball.dataset.state).toBe('error');
    await vi.advanceTimersByTimeAsync(1000);
    expect(ball.dataset.state).toBe('idle');
    expect(ball.textContent).toBe(message('en', 'ballGlyph'));
    stop();
    vi.useRealTimers();
  });

  test('一个订阅者出错：别的照常更新，这次选择照常生效', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const off = onUiLocaleChange(() => {
      throw new Error('boom');
    });
    const stop = createInputDot({ translate: async () => {} });
    const dot = shadowOf('input-dot').querySelector<HTMLElement>('.pt-input-dot')!;
    expect(await loadUiLocale('en', fromRepo)).toBe(true);
    expect(dot.getAttribute('aria-label')).toBe(message('en', 'inputDotLabel'));
    expect(t('translate')).toBe(message('en', 'translate'));
    off();
    stop();
    error.mockRestore();
  });

  test('移除之后不再改它（不留订阅）', async () => {
    const stop = createBall({ onToggle: () => {} });
    const ball = shadowOf('ball').querySelector<HTMLElement>('.pt-ball')!;
    stop();
    const before = ball.getAttribute('aria-label');
    await loadUiLocale('en', fromRepo);
    expect(ball.getAttribute('aria-label')).toBe(before);
  });
});

describe('更新提示', () => {
  const entry: ChangelogEntry = {
    version: '9.9.9',
    groups: [
      {
        type: 'feature',
        items: [{ title: { zh_CN: '简体条目', zh_TW: '繁體條目', en: 'English item' }, desc: { zh_CN: '', zh_TW: '', en: '' } }],
      },
    ],
  };
  const card = () => document.getElementById('pt-host-changelog')!.shadowRoot!;

  test('浏览器是简体中文、扩展语言选 en：标题、分组名与条目都是英文', async () => {
    vi.mocked(chrome.i18n.getUILanguage).mockReturnValue('zh-CN');
    await loadUiLocale('en', fromRepo);
    showChangelog(entry);
    const text = card().textContent!;
    expect(text).toContain(message('en', 'changelogTitle'));
    expect(text).toContain(message('en', 'changelogGroupFeature'));
    expect(text).toContain('English item');
    expect(text).not.toContain('简体条目');
    card().querySelector<HTMLButtonElement>('.pt-changelog-ok')!.click();
  });
});

describe('右键菜单标题', () => {
  // setup 的 chrome 替身没有 contextMenus，只在这一组里挂上
  beforeEach(() => {
    (chrome as { contextMenus?: unknown }).contextMenus = {
      update: vi.fn().mockResolvedValue(undefined),
    };
  });
  afterEach(() => {
    delete (chrome as { contextMenus?: unknown }).contextMenus;
  });

  test('按当前扩展语言更新', async () => {
    await loadUiLocale('en', fromRepo);
    await refreshContextMenuTitle();
    expect(chrome.contextMenus.update).toHaveBeenCalledWith('pt-translate-selection', {
      title: message('en', 'ctxTranslateSelection'),
    });
  });

  test('菜单还没建（首装 onInstalled 之前）：不报错', async () => {
    vi.mocked(chrome.contextMenus.update).mockRejectedValue(new Error('Cannot find menu item'));
    await expect(refreshContextMenuTitle()).resolves.toBeUndefined();
  });
});
