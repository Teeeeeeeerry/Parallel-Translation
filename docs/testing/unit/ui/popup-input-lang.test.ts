/**
 * popup：输入翻译这一次译成什么语言（#662）
 *
 * 页面语言判错时的出路：popup 里多一个选择器，第一项“跟随设置”（走
 * ADR-0005 的判定链），后面是可选语言。选择立即交给本页主文档保存 ——
 * 与领域的临时选择（#400）并列，只存在本标签页当前页面里，不是设置项，
 * 不写设置。打开 popup 时向主文档问当前的选择并显示出来。
 *
 * #663：选择广播给本页全部 frame（不带 frameId），主文档回复；在翻译时
 * 生效由端到端 TC-E2E-161 覆盖。
 *
 * 从 popup 的渲染与消息发送这条缝测：DOM 里有没有这个选择器、选项是什么、
 * 选完向页面发了什么消息、页面回复的选择怎么显示。
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { LANG_LIST } from '~/src/storage/schema';
import { INPUT_LANG_CHOICE, tabChoiceMessages } from '~/src/ui/tab-choice';

const INPUT_LANG = tabChoiceMessages(INPUT_LANG_CHOICE.name);

const settings = vi.hoisted(() => ({
  enabled: true,
  enginePriority: ['google-web'],
  from: 'auto',
  to: 'zh-CN',
  displayMode: 'bilingual',
  style: 'default',
  models: {},
}));

const patchSettings = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('~/src/storage/settings', () => ({
  settingsReady: vi.fn(async () => settings),
  getSettings: vi.fn(() => settings),
  patchSettings,
  onSettingsChanged: vi.fn(() => () => {}),
}));

/** 页面主文档那一侧：按消息类型回复，记下收到的每条消息与发送选项。 */
type Sent = { msg: { type: string; [k: string]: unknown }; opts: unknown };
let sent: Sent[];
let reply: (msg: Sent['msg']) => unknown;

async function openPopup(): Promise<void> {
  const html = readFileSync('entrypoints/popup/index.html', 'utf8');
  document.body.innerHTML = html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/^<body[^>]*>/, '');
  const c = chrome as unknown as Record<string, any>;
  c.runtime.getManifest = vi.fn(() => ({ version: '0.0.0' }));
  c.runtime.openOptionsPage = vi.fn();
  c.tabs = {
    query: vi.fn(async () => [{ id: 7 }]),
    sendMessage: vi.fn(async (_tabId: number, msg: Sent['msg'], opts?: unknown) => {
      sent.push({ msg, opts });
      return reply(msg);
    }),
    create: vi.fn(),
  };
  // 每条用例重新加载 popup 入口。它在 DOMContentLoaded 时初始化；前面用例
  // 加载的入口也挂着同样的监听，所以只取这一次挂上的那个来调用
  let init: EventListener | undefined;
  const spy = vi.spyOn(document, 'addEventListener').mockImplementation((type, fn) => {
    if (type === 'DOMContentLoaded') init = fn as EventListener;
  });
  vi.resetModules();
  try {
    await import('~/entrypoints/popup/main');
  } finally {
    spy.mockRestore();
  }
  init!(new Event('DOMContentLoaded'));
}

const select = () => document.getElementById('pt-input-lang-select') as HTMLSelectElement | null;
const sentOf = (type: string) => sent.filter((s) => s.msg.type === type);

beforeEach(() => {
  document.body.innerHTML = '';
  sent = [];
  patchSettings.mockClear();
  // 默认：本页还没有临时选择
  reply = (msg) => {
    if (msg.type === INPUT_LANG.get) return { choice: { kind: 'auto' } };
    if (msg.type === INPUT_LANG.set) return { choice: msg.choice };
    return undefined;
  };
});

describe('popup 里的“这一次译成”选择器（#662）', () => {
  test('有这个选择器：第一项“跟随设置”，后面是可选语言（不含“自动检测”），文案走界面文案', async () => {
    await openPopup();
    await vi.waitFor(() => expect(select()?.disabled).toBe(false));
    const options = [...select()!.options];
    // jsdom 里 getMessage 原样返回 key：标签是 key 说明走的是界面文案
    expect(options[0]!.value).toBe('auto');
    expect(options[0]!.textContent).toBe('inputLangPopupFollow');
    expect(options.slice(1).map((o) => o.value)).toEqual(
      LANG_LIST.filter((l) => l.code !== 'auto').map((l) => l.code),
    );
    expect(document.querySelector('[data-i18n="inputLangPopupLabel"]')).not.toBeNull();
  });

  test('打开时向本页主文档问当前的选择，没有临时选择时显示“跟随设置”', async () => {
    await openPopup();
    await vi.waitFor(() => expect(select()?.disabled).toBe(false));
    expect(select()!.value).toBe('auto');
    const asks = sentOf(INPUT_LANG.get);
    expect(asks).toHaveLength(1);
    // 只问主文档：子 frame 不回答这一问
    expect(asks[0]!.opts).toEqual({ frameId: 0 });
  });

  test('本页已经选过一种语言：打开时显示它', async () => {
    reply = (msg) =>
      msg.type === INPUT_LANG.get ? { choice: { kind: 'lang', lang: 'en' } } : undefined;
    await openPopup();
    await vi.waitFor(() => expect(select()?.value).toBe('en'));
  });

  test('选一种语言 → 立即把这一次的选择广播给本页全部 frame，按主文档的回复显示（#663）', async () => {
    await openPopup();
    await vi.waitFor(() => expect(select()?.disabled).toBe(false));
    select()!.value = 'ja';
    select()!.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(sentOf(INPUT_LANG.set)).toHaveLength(1));
    const [set] = sentOf(INPUT_LANG.set);
    expect(set!.msg.choice).toEqual({ kind: 'lang', lang: 'ja' });
    // 不带 frameId：带了只有主文档收得到，all_frames 注入的 iframe 收不到
    expect(set!.opts).toBeUndefined();
    expect(select()!.value).toBe('ja');
  });

  test('选回“跟随设置” → 交给页面的是 auto，不是某种语言', async () => {
    reply = (msg) => {
      if (msg.type === INPUT_LANG.get) return { choice: { kind: 'lang', lang: 'en' } };
      if (msg.type === INPUT_LANG.set) return { choice: msg.choice };
      return undefined;
    };
    await openPopup();
    await vi.waitFor(() => expect(select()?.value).toBe('en'));
    select()!.value = 'auto';
    select()!.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(sentOf(INPUT_LANG.set)).toHaveLength(1));
    expect(sentOf(INPUT_LANG.set)[0]!.msg.choice).toEqual({ kind: 'auto' });
    expect(select()!.value).toBe('auto');
  });

  test('这一次的选择不是设置项：选完不写设置', async () => {
    await openPopup();
    await vi.waitFor(() => expect(select()?.disabled).toBe(false));
    select()!.value = 'en';
    select()!.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(sentOf(INPUT_LANG.set)).toHaveLength(1));
    expect(patchSettings).not.toHaveBeenCalled();
  });

  test('页面回复的选择形状不对 → 当没有回复：与问不到同样处理，禁用、显示“跟随设置”', async () => {
    vi.useFakeTimers();
    try {
      for (const bad of [{ kind: 'lang' }, { kind: 'lang', lang: 42 }, { kind: 'lang', lang: 'xx-NOPE' }, { kind: 'domain', id: 'x' }, 'en']) {
        reply = (msg) => (msg.type === INPUT_LANG.get ? { choice: bad } : undefined);
        await openPopup();
        await vi.advanceTimersByTimeAsync(6000);
        expect(select()!.disabled, JSON.stringify(bad)).toBe(true);
        expect(select()!.value, JSON.stringify(bad)).toBe('auto');
      }
    } finally {
      vi.useRealTimers();
    }
  });

  test('本页不支持内容脚本（问不到）→ 选择器禁用', async () => {
    vi.useFakeTimers();
    try {
      reply = () => {
        throw new Error('Could not establish connection');
      };
      await openPopup();
      // 有界重试走完（与领域下拉同一个序列，约 5 秒）
      await vi.advanceTimersByTimeAsync(6000);
      expect(select()!.disabled).toBe(true);
      expect(select()!.value).toBe('auto');
    } finally {
      vi.useRealTimers();
    }
  });
});
