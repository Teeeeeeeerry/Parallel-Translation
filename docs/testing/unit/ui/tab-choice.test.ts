/**
 * 标签页临时选择（#1121，父 #1113）
 *
 * 假的消息通道：一个标签页里一个主文档、若干子 frame，各自一份
 * createTabChoices；frame 发给后台的消息交给真实的 tabChoiceForwarder，后台发给
 * 标签页的消息按 frameId 投给对应的 frame（不带 frameId 就是广播）。只看外部行为：
 * 设新值后各 frame 读到什么、跳页后读到什么、启动询问与广播交错时最终读到什么。
 */
import { describe, test, expect } from 'vitest';
import {
  createTabChoices,
  tabChoiceForwarder,
  tabChoiceMessages,
  type TabChoice,
  type TabChoiceKind,
  type TabChoices,
} from '~/src/ui/tab-choice';

type Choice = { kind: 'auto' } | { kind: 'none' } | { kind: 'domain'; id: string };
const KIND: TabChoiceKind<Choice> = {
  name: 'domain',
  parse: (v) => {
    const c = v as Choice | undefined;
    if (c?.kind === 'auto' || c?.kind === 'none') return { kind: c.kind };
    if (c?.kind === 'domain' && typeof c.id === 'string') return { kind: 'domain', id: c.id };
    return null;
  },
};
const MSG = tabChoiceMessages('domain');
const flush = () => new Promise((r) => setTimeout(r, 0));

/** 一个可以手动改网址、发 popstate 的主文档环境。 */
function fakeLocation(href: string) {
  const win = new EventTarget();
  return {
    win,
    getHref: () => href,
    go(next: string) {
      href = next;
      win.dispatchEvent(new Event('popstate'));
    },
  };
}

function tab(opts: { holdTopAnswer?: boolean } = {}) {
  const loc = fakeLocation('https://forum.example/t/1');
  const frames: { id: number; choices: TabChoices; choice: TabChoice<Choice> }[] = [];
  /** 主文档对后台转问的回答可以先扣住，模拟询问在飞 */
  const held: (() => void)[] = [];
  const deliver = (frameId: number, msg: unknown) =>
    new Promise<unknown>((resolve) => {
      const f = frames.find((x) => x.id === frameId);
      if (!f || !f.choices.handle(msg, resolve)) resolve(undefined);
      // 子 frame 不回复设新值：给个结果免得一直挂着
      setTimeout(() => resolve(undefined), 0);
    });
  const tabsSend = (_tabId: number, msg: unknown, o?: { frameId: number }) => {
    if (o) {
      const answer = () => deliver(o.frameId, msg);
      if (opts.holdTopAnswer && (msg as { type: string }).type === MSG.get) {
        // 主文档当场答的是当时的值，回复在路上被扣住
        const answered = answer();
        return new Promise<unknown>((resolve) => held.push(() => void answered.then(resolve)));
      }
      return answer();
    }
    return Promise.all(frames.map((f) => deliver(f.id, msg)));
  };
  const forward = tabChoiceForwarder([KIND], tabsSend);
  const addFrame = (id: number) => {
    const choices = createTabChoices({
      isMainFrame: id === 0,
      sendMessage: (msg) =>
        new Promise((resolve) => {
          if (!forward(msg, { tab: { id: 7 }, frameId: id }, resolve)) resolve(undefined);
        }),
      ...(id === 0 && { getHref: loc.getHref, win: loc.win }),
    });
    const frame = { id, choices, choice: choices.define(KIND) };
    frames.push(frame);
    return frame;
  };
  /** popup 设新值：广播到全部 frame，返回主文档的回复 */
  const popupSet = async (choice: Choice) => {
    const replies = (await tabsSend(7, { type: MSG.set, choice })) as unknown[];
    return replies[0];
  };
  return { loc, addFrame, popupSet, frames, releaseTop: () => held.splice(0).forEach((f) => f()) };
}

describe('标签页临时选择（#1121）', () => {
  test('设新值后本标签页所有 frame 读到新值，只有主文档回复', async () => {
    const t = tab();
    const top = t.addFrame(0);
    const sub = t.addFrame(1);
    await flush();
    expect(await t.popupSet({ kind: 'domain', id: 'law' })).toEqual({ choice: { kind: 'domain', id: 'law' } });
    expect(top.choice.get()).toEqual({ kind: 'domain', id: 'law' });
    expect(sub.choice.get()).toEqual({ kind: 'domain', id: 'law' });
  });

  test('不认识的值不采用', async () => {
    const t = tab();
    const top = t.addFrame(0);
    await t.popupSet({ kind: 'bogus' } as unknown as Choice);
    expect(top.choice.get()).toEqual({ kind: 'auto' });
  });

  test('切换之后才加载的子 frame 启动时拿到主文档的当前值', async () => {
    const t = tab();
    const top = t.addFrame(0);
    await t.popupSet({ kind: 'none' });
    const late = t.addFrame(2);
    expect(late.choice.get()).toEqual({ kind: 'auto' });
    await flush();
    expect(late.choice.get()).toEqual({ kind: 'none' });
    expect(top.choice.get()).toEqual({ kind: 'none' });
  });

  test('启动询问在飞时新的广播到达：以广播为准', async () => {
    const t = tab({ holdTopAnswer: true });
    t.addFrame(0);
    await t.popupSet({ kind: 'domain', id: 'old' });
    const late = t.addFrame(3);
    await flush();
    // 询问还扣着，popup 又切了一次
    await t.popupSet({ kind: 'domain', id: 'new' });
    expect(late.choice.get()).toEqual({ kind: 'domain', id: 'new' });
    // 主文档答的旧值这时才回来：不采用
    t.releaseTop();
    await flush();
    await flush();
    expect(late.choice.get()).toEqual({ kind: 'domain', id: 'new' });
  });

  test('换了路径：所有 frame 回到自动', async () => {
    const t = tab();
    const top = t.addFrame(0);
    const sub = t.addFrame(1);
    await t.popupSet({ kind: 'domain', id: 'law' });
    t.loc.go('https://forum.example/t/2');
    await flush();
    await flush();
    expect(top.choice.get()).toEqual({ kind: 'auto' });
    expect(sub.choice.get()).toEqual({ kind: 'auto' });
  });

  test('只换查询参数或 hash：保持', async () => {
    const t = tab();
    const top = t.addFrame(0);
    const sub = t.addFrame(1);
    await t.popupSet({ kind: 'none' });
    t.loc.go('https://forum.example/t/1?sort=new#c5');
    await flush();
    expect(top.choice.get()).toEqual({ kind: 'none' });
    expect(sub.choice.get()).toEqual({ kind: 'none' });
  });

  test('没有 Navigation API 收不到 pushState：读之前补判一次路径', async () => {
    let href = 'https://forum.example/t/1';
    const sent: unknown[] = [];
    const choices = createTabChoices({
      isMainFrame: true,
      sendMessage: async (msg) => void sent.push(msg),
      getHref: () => href,
      win: new EventTarget(),
    });
    const choice = choices.define(KIND);
    choice.set({ kind: 'none' });
    href = 'https://forum.example/t/9';
    expect(choice.get()).toEqual({ kind: 'auto' });
    expect(sent).toEqual([{ type: MSG.navigated }]);
  });

  test('已是自动时跳页不广播', async () => {
    let href = 'https://forum.example/t/1';
    const sent: unknown[] = [];
    const choices = createTabChoices({
      isMainFrame: true,
      sendMessage: async (msg) => void sent.push(msg),
      getHref: () => href,
      win: new EventTarget(),
    });
    const choice = choices.define(KIND);
    href = 'https://forum.example/t/2';
    expect(choice.get()).toEqual({ kind: 'auto' });
    expect(sent).toEqual([]);
  });

  test('后台只认主文档报来的跳页；不是临时选择的消息不处理', () => {
    const calls: unknown[] = [];
    const forward = tabChoiceForwarder([KIND], async (...args) => void calls.push(args));
    expect(forward({ type: MSG.navigated }, { tab: { id: 1 }, frameId: 3 }, () => {})).toBeUndefined();
    expect(calls).toEqual([]);
    forward({ type: MSG.navigated }, { tab: { id: 1 }, frameId: 0 }, () => {});
    expect(calls).toEqual([[1, { type: MSG.set, choice: { kind: 'auto' } }]]);
    expect(forward({ type: 'pt:other' }, { tab: { id: 1 }, frameId: 0 }, () => {})).toBeUndefined();
  });

  test('消息名由种类生成', () => {
    expect(tabChoiceMessages('domain')).toEqual({
      set: 'pt:set-domain',
      get: 'pt:get-domain-choice',
      top: 'pt:top-domain-choice',
      navigated: 'pt:domain-path-changed',
    });
  });
});
