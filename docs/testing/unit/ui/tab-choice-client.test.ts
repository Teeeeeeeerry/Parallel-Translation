/**
 * “标签页临时选择”的 popup 侧客户端（#1143）
 *
 * popup 的领域与对方语言下拉原先各写一份“查当前标签页 → 只问主文档 → 有界
 * 重试 → 防较早的回复覆盖较新的 → 设值后广播”。现在收在模块的客户端里；
 * 这里配假的标签页消息，只看外部行为：读到什么值、重试几次、较早回复晚到时
 * 是否被丢弃、设值后发出了什么。
 */
import { describe, test, expect, vi } from 'vitest';
import {
  DOMAIN_CHOICE,
  INPUT_LANG_CHOICE,
  TAB_CHOICE_RETRY_DELAYS_MS,
  tabChoiceClient,
  tabChoiceMessages,
  type TabChoiceClientDeps,
} from '~/src/ui/tab-choice';

type Msg = { type: string; [k: string]: unknown };

function deps(reply: (msg: Msg, opts?: { frameId: number }) => Promise<unknown>, tab: number | null = 7) {
  const sent: { tabId: number; msg: Msg; opts?: { frameId: number } }[] = [];
  const slept: number[] = [];
  const d: TabChoiceClientDeps = {
    activeTab: async () => tab ?? undefined,
    send: async (tabId, msg, opts) => {
      sent.push({ tabId, msg: msg as Msg, opts });
      return reply(msg as Msg, opts);
    },
    sleep: async (ms) => {
      slept.push(ms);
    },
  };
  return { d, sent, slept };
}

const DOMAIN = tabChoiceMessages(DOMAIN_CHOICE.name);
const INPUT = tabChoiceMessages(INPUT_LANG_CHOICE.name);
const state = { host: 'example.com', autoName: '法律', choice: { kind: 'auto' }, options: [{ id: 'user:1', name: '法律' }] };

describe('读当前值', () => {
  test('只问主文档，带上额外字段；回复解析成领域状态', async () => {
    const { d, sent } = deps(async () => state);
    const show = vi.fn();
    await tabChoiceClient(DOMAIN_CHOICE, d).read(show, { to: 'zh-CN' });
    expect(sent).toEqual([{ tabId: 7, msg: { type: DOMAIN.get, to: 'zh-CN' }, opts: { frameId: 0 } }]);
    expect(show).toHaveBeenCalledWith(state);
  });

  test('对方语言缺省只认 { choice }；形状不对按问不到处理并重试', async () => {
    const replies: unknown[] = [{ choice: { kind: 'bogus' } }, { choice: { kind: 'lang', lang: 'en' } }];
    const { d, sent } = deps(async () => replies.shift());
    const show = vi.fn();
    await tabChoiceClient(INPUT_LANG_CHOICE, d).read(show);
    expect(sent.map((s) => s.msg.type)).toEqual([INPUT.get, INPUT.get]);
    expect(show).toHaveBeenCalledWith({ choice: { kind: 'lang', lang: 'en' } });
  });

  test('内容脚本没就绪：按重试序列有界重试，问不到时显示 null', async () => {
    const { d, sent, slept } = deps(async () => {
      throw new Error('Receiving end does not exist');
    });
    const show = vi.fn();
    await tabChoiceClient(DOMAIN_CHOICE, d).read(show);
    expect(slept).toEqual(TAB_CHOICE_RETRY_DELAYS_MS);
    expect(sent).toHaveLength(TAB_CHOICE_RETRY_DELAYS_MS.length + 1);
    expect(show).toHaveBeenCalledWith(null);
  });

  test('拿不到标签页：不发消息，显示 null', async () => {
    const { d, sent } = deps(async () => state, null);
    const show = vi.fn();
    await tabChoiceClient(DOMAIN_CHOICE, d).read(show);
    expect(sent).toEqual([]);
    expect(show).toHaveBeenCalledWith(null);
  });

  test('较早的读取晚到：被更晚的读或设取代后不再显示', async () => {
    let release!: (v: unknown) => void;
    const first = new Promise((r) => (release = r));
    let n = 0;
    const { d } = deps(async (msg) => (msg.type === DOMAIN.get && n++ === 0 ? first : { ...state, choice: { kind: 'none' } }));
    const client = tabChoiceClient(DOMAIN_CHOICE, d);
    const show = vi.fn();
    const slow = client.read(show);
    await client.set({ kind: 'none' }, show);
    release(state);
    await slow;
    expect(show.mock.calls).toEqual([[{ ...state, choice: { kind: 'none' } }]]);
  });
});

describe('设新值', () => {
  test('广播到本页全部 frame（不带 frameId），带上额外字段；显示主文档的回复', async () => {
    const { d, sent } = deps(async (msg) => ({ ...state, choice: msg.choice }));
    const show = vi.fn();
    const ok = await tabChoiceClient(DOMAIN_CHOICE, d).set({ kind: 'domain', id: 'user:1' }, show, { to: 'zh-CN' });
    expect(ok).toBe(true);
    expect(sent).toEqual([
      { tabId: 7, msg: { type: DOMAIN.set, choice: { kind: 'domain', id: 'user:1' }, to: 'zh-CN' }, opts: undefined },
    ]);
    expect(show).toHaveBeenCalledWith({ ...state, choice: { kind: 'domain', id: 'user:1' } });
  });

  test('发送失败或拿不到标签页：返回 false，不显示', async () => {
    const show = vi.fn();
    const failing = deps(async () => {
      throw new Error('no receiver');
    });
    expect(await tabChoiceClient(INPUT_LANG_CHOICE, failing.d).set({ kind: 'auto' }, show)).toBe(false);
    const noTab = deps(async () => ({}), null);
    expect(await tabChoiceClient(INPUT_LANG_CHOICE, noTab.d).set({ kind: 'auto' }, show)).toBe(false);
    expect(noTab.sent).toEqual([]);
    expect(show).not.toHaveBeenCalled();
  });

  test('连续两次设值：先发起的回复晚到时不覆盖后一次', async () => {
    let releaseFirst!: (v: unknown) => void;
    const first = new Promise((r) => (releaseFirst = r));
    let n = 0;
    const { d } = deps(async (msg) => (n++ === 0 ? first : { choice: msg.choice }));
    const client = tabChoiceClient(INPUT_LANG_CHOICE, d);
    const show = vi.fn();
    const a = client.set({ kind: 'lang', lang: 'ja' }, show);
    await client.set({ kind: 'lang', lang: 'en' }, show);
    releaseFirst({ choice: { kind: 'lang', lang: 'ja' } });
    await a;
    expect(show.mock.calls).toEqual([[{ choice: { kind: 'lang', lang: 'en' } }]]);
  });
});
