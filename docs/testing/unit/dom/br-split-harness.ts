/**
 * 以 br 分行的超长段落（#694）几张票共用的测试脚手架。
 *
 * 只经外部入口：采集入口 collect、整页翻译的编排入口 translatePage（真实
 * 渲染器），以及还原。还原与“是否已翻译”用 content script 同一份实现
 * （src/dom/page-dom.ts，#1116）。
 *
 * 夹具一律用文字真正超过长度上限的段落：#768 之后按 br 切行只看文字长度，
 * 文字不长、只是链接多的段落整段作为一个单元，根本不走切行。
 */
import { vi } from 'vitest';
import { mockAllBoundingRects } from '../../setup';
import { collect, type CollectOptions } from '~/src/dom/walker';
import { render } from '~/src/dom/renderer';
import { hasBlockTextChildren, restorePreserves, unitTextEx } from '~/src/dom/text';
import { hasTranslated } from '~/src/dom/page-dom';
import { createOrchestrator } from '~/src/orchestration/orchestrator';
import { MAX_TEXT } from '~/src/dom/classify';

/** 对话体的一行，约 70 字符。 */
export const line = (i: number) => `Line ${i}: "I never thought we would meet again," she said quietly.`;

/** n 行对话，行与行之间用 sep 隔开；行数足够让整段文字超过长度上限。 */
export function brLines(n: number, sep = '<br>\n', render: (i: number) => string = line): string {
  return Array.from({ length: n }, (_, i) => render(i)).join(sep);
}

/** 文字是否超过长度上限：夹具自检，免得写出不走切行的用例。 */
export function isOverLimit(el: Element): boolean {
  return (el.textContent ?? '').trim().length > MAX_TEXT;
}

/** 采集一次（与 content script 同一口径取送翻文本），返回单元、送翻文本与占位符表。 */
export function collectUnits(opts: CollectOptions = {}): {
  units: Element[];
  texts: string[];
  preserves: Map<string, string>[];
} {
  const restore = mockAllBoundingRects();
  try {
    const units = collect(document.body, undefined, opts);
    const extracted = units.map((u) => unitTextEx(u, { shallow: hasBlockTextChildren(u) }));
    return { units, texts: extracted.map((e) => e.text), preserves: extracted.map((e) => e.preserves) };
  } finally {
    restore();
  }
}

/** 替身引擎的译文：原文前加前缀。 */
export const fakeTranslate = (t: string) => `【译】${t}`;

/**
 * 整页翻译一遍：采集、经编排入口分批送翻（替身引擎）、真实渲染器渲染。
 * 渲染前与 content script 一样把占位符换回原文（排除与保留原文命中的行内
 * 元素，#58、#441）。返回每一批送出去的文本（按请求分组）。
 */
export async function translatePage(opts: CollectOptions = {}): Promise<{ requests: string[][] }> {
  const { units, texts, preserves } = collectUnits(opts);
  const requests: string[][] = [];
  const orch = createOrchestrator({
    send: vi.fn(async (req: { texts: string[] }) => {
      requests.push([...req.texts]);
      return { ok: true, data: { translations: req.texts.map(fakeTranslate) } };
    }),
    hasTranslated,
    onBatchResult: (_i, batch, res) => {
      if (!res.ok || !res.data) return;
      batch.forEach((item, j) => {
        const i = units.indexOf(item.ctx as Element);
        const map = preserves[i]!;
        const restored = restorePreserves(res.data!.translations[j]!, map, item.text);
        render(item.ctx as Element, restored, 'page', restorePreserves(item.text, map, item.text));
      });
    },
  } as Parameters<typeof createOrchestrator>[0]);
  orch.start();
  await orch.translatePage(
    units.map((el, i) => ({ text: texts[i]!, ctx: el })),
    'auto',
    'zh-CN',
  );
  orch.stop();
  return { requests };
}

/** 还原：content script 同一份实现（#1116）。 */
export { restorePage } from '~/src/dom/page-dom';
