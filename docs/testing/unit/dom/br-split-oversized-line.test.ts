/**
 * 以 br 分行的超长段落：切成行之后单行仍超过长度上限，该行不翻，其余行照常
 * （#710，规格 #694）
 *
 * 整段一句话不断行的那一行，切成行之后仍比上限长：不在句子中间硬切（断句
 * 错乱的译文比不翻更糟），也不把整段退回不翻。这一行按跳过处置 —— 进整页
 * 翻译结束时的跳过汇总（#727），原因是文字超过长度上限；同段落其余行照常
 * 切块、送翻、有译文；悬停在这一行上不浮出逐段翻译按钮。
 *
 * 经采集入口 collect（含跳过回调）、整页翻译的编排入口 togglePage 与汇总
 * pageNotice、逐段翻译入口 closestUnit，以及还原断言。
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOrchestrator } from '~/src/orchestration/orchestrator';
import { mockAllBoundingRects } from '../../setup';
import { MAX_TEXT, closestUnit } from '~/src/dom/classify';
import { collect, type SkipCategory } from '~/src/dom/walker';
import { hasBlockTextChildren, unitTextEx } from '~/src/dom/text';
import { domPage } from '../orchestration/page-harness';
import { emptyRenderStats, emptySkipStats, pageNotice } from '~/src/orchestration/page-summary';
import { brLines, collectUnits, fakeTranslate, isOverLimit, line, restorePage, translatePage } from './br-split-harness';

/** 一整句不断行、比长度上限还长的一行。 */
const GIANT = Array.from({ length: 80 }, (_, i) => `the river kept running past mile ${i} and nobody stopped`).join(', ') + '.';

const HEAD = Array.from({ length: 30 }, (_, i) => line(i));
const TAIL = Array.from({ length: 30 }, (_, i) => line(i + 30));

/** 前后各 30 行对话，中间夹着 giants 行超长的整句。 */
function post(giants = 1): string {
  const middle = Array.from({ length: giants }, (_, i) => `${GIANT} (${i})`).join('<br>\n');
  return `<p id="post">${brLines(30)}<br>\n${middle}<br>\n${brLines(30, '<br>\n', (i) => line(i + 30))}</p>`;
}

const giantNode = () =>
  [...document.getElementById('post')!.childNodes].find((n) => (n.textContent ?? '').trim().startsWith(GIANT))!;

/** 采集一次，记下跳过回调报出的类别。 */
function collectSkips(): SkipCategory[] {
  const seen: SkipCategory[] = [];
  collectUnits({ onSkip: (_el, c) => seen.push(c) });
  return seen;
}

beforeEach(() => {
  vi.mocked(chrome.i18n.getMessage).mockImplementation(
    (key: string, subs?: string | (string | number)[]) =>
      [key, ...(subs === undefined ? [] : ([] as (string | number)[]).concat(subs))].join(':'),
  );
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('单行仍超过上限：该行不成切块，其余行照常（#710）', () => {
  test('夹具自检：超长那一行自己就比上限长，整段也超上限', () => {
    expect(GIANT.length).toBeGreaterThan(MAX_TEXT);
    document.body.innerHTML = post();
    expect(isOverLimit(document.getElementById('post')!)).toBe(true);
  });

  test('采集：其余 60 行各成一个切块单元，超长那一行不成单元、不被往下切', () => {
    document.body.innerHTML = post();
    const { units, texts } = collectUnits();
    expect(texts.map((t) => t.trim())).toEqual([...HEAD, ...TAIL]);
    expect(units.every((u) => u.classList.contains('pt-chunk'))).toBe(true);
    // 超长那一行原样留在段落里：是段落的直接文本节点，不在任何切块里
    const giant = giantNode();
    expect(giant.nodeType).toBe(Node.TEXT_NODE);
    expect(giant.parentElement!.id).toBe('post');
  });

  test('跳过回调：超长那一行报一次“文字过长”，两行就报两次', () => {
    document.body.innerHTML = post(1);
    expect(collectSkips()).toEqual(['too-long']);
    document.body.innerHTML = post(2);
    expect(collectSkips()).toEqual(['too-long', 'too-long']);
  });

  test('段落已经被切过（增量补翻、之前一次采集）：再采集照样报出这一行，不因为没有重新切分而漏', () => {
    document.body.innerHTML = post();
    collect(document.body); // 不带回调的一次采集，例如增量补翻
    expect(document.getElementById('post')!.getAttribute('data-pt-split')).toBe('1');
    expect(collectSkips()).toEqual(['too-long']);
  });

  test('只读采集（闸门取样）不切，也不另报这一行：整段按文字过长报一次', () => {
    document.body.innerHTML = post();
    const seen: SkipCategory[] = [];
    collectUnits({ readOnly: true, onSkip: (_el, c) => seen.push(c) });
    expect(seen).toEqual(['too-long']);
    expect(document.getElementById('post')!.hasAttribute('data-pt-split')).toBe(false);
  });

  test('悬停在超长那一行上不浮出逐段翻译按钮；悬停在其余行上照常找到那一行的切块', () => {
    document.body.innerHTML = `<div id="wrap">${post()}</div>`;
    collectUnits();
    const p = document.getElementById('post')!;
    const restoreRects = mockAllBoundingRects();
    try {
      // 超长那一行是段落的直接文本：悬停起点就是段落本身
      expect(closestUnit(p)).toBeNull();
      const chunk = p.querySelector('.pt-chunk')!;
      expect(closestUnit(chunk)).toBe(chunk);
    } finally {
      restoreRects();
    }
  });
});

describe('整页翻译：其余行有译文，汇总报出被跳过的这一行（#710）', () => {
  async function togglePage() {
    const sent: string[] = [];
    const restoreRects = mockAllBoundingRects();
    const orch = createOrchestrator({
      send: vi.fn(async (req: { texts: string[] }) => {
        sent.push(...req.texts);
        return { ok: true, data: { translations: req.texts.map(fakeTranslate) } };
      }),
    });
    orch.start();
    // 与 content 同一口径的整页翻译会话（#1077、#1078）：首轮与补采集共用，同一元素只交出一次、跳过只计一次
    const page = domPage({
      build: (el) => ({ text: unitTextEx(el, { shallow: hasBlockTextChildren(el) }).text, ctx: el }),
    });
    const result = await orch.togglePage(page, 'auto', 'zh-CN');
    orch.stop();
    restoreRects();
    const stats = page.current()?.totals() ?? emptyRenderStats();
    const skips = page.current()?.skips() ?? emptySkipStats();
    return { result, notice: pageNotice(result, stats, skips), skips, sent };
  }

  test('其余 60 行各有一条译文；超长那一行没送翻；结束时弹“另有 1 段未被采集，主要是文字过长”', async () => {
    document.body.innerHTML = post();
    const { result, notice, skips, sent } = await togglePage();
    expect(result.status).toBe('translated');
    expect(sent.map((t) => t.trim())).toEqual([...HEAD, ...TAIL]);
    expect(sent.some((t) => t.includes('the river kept running'))).toBe(false);

    const trans = [...document.querySelectorAll('#post .pt-chunk > .pt-trans')].map((t) => t.textContent!.trim());
    expect(trans).toEqual([...HEAD, ...TAIL].map(fakeTranslate));

    expect(skips['too-long']).toBe(1);
    expect(notice).toEqual({ message: 'toastSkippedTooLong:1', kind: 'info' });
  });

  test('超长那一行之外全是空行或没有别的行：段落不切，整段按文字过长报一次（行为不变）', async () => {
    document.body.innerHTML = `<p id="post"><br>\n${GIANT}<br><br></p>`;
    const { result, notice } = await togglePage();
    expect(result.status).toBe('no-elements');
    expect(document.getElementById('post')!.hasAttribute('data-pt-split')).toBe(false);
    expect(notice).toEqual({ message: 'toastSkippedTooLong:1', kind: 'info' });
  });
});

describe('还原之后逐字节回到原样（#710）', () => {
  test('一行超长、其余行翻译之后还原，段落 HTML 与翻译前一字不差；再翻再还原仍一样', async () => {
    document.body.innerHTML = post(2);
    const before = document.body.innerHTML;
    await translatePage();
    expect(document.querySelectorAll('[data-pt="done"]')).toHaveLength(60);
    restorePage();
    expect(document.body.innerHTML).toBe(before);

    await translatePage();
    restorePage();
    expect(document.body.innerHTML).toBe(before);
  });
});
