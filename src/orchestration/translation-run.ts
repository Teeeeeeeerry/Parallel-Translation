// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 翻译运行（#1066）：“这次不要了”只在这里产出。
//
// 有两个根作用域：页面根随还原整页中止，并立即换一个新的；输入根不随还原 ——
// 用户在输入框里点的翻译与页面的翻译态无关（#1044）。每一次翻译运行从其中
// 一个根派生一个信号，可以再叠加调用方自己的信号（划词的“后发顶掉先发”），
// 任一来源中止，这次运行就中止。信号往下交给发送层，后台据此中止引擎调用。
//
// 运行结束要调 end()：从根上摘掉监听，根活得比运行久，不摘会越挂越多。
//
// #1073：运行也可以自己中止（abort），带上原因。某一批判了失效（扩展上下文
// 失效、配额耗尽）时，这次运行以 RunInvalidated 中止 —— 别的批次据此不再发出；
// 汇总按原因区分“失效”（要提示真实原因）与“放弃”（不提示）。

/** 运行从哪个根派生：page 随还原中止，input 不随还原。 */
export type RunRoot = 'page' | 'input';

/** 运行因失效而中止的原因（#1073）：不是放弃，失效原因要进汇总与提示。 */
export class RunInvalidated {
  constructor(readonly error: string) {}
}

/** 这次运行是否被放弃：已中止，且不是因为失效（#1073）。 */
export function isAbandoned(signal: AbortSignal): boolean {
  return signal.aborted && !(signal.reason instanceof RunInvalidated);
}

/** 一次翻译运行。 */
export interface TranslationRun {
  /** 这次运行的中止信号：根或叠加的调用方信号中止时中止。 */
  readonly signal: AbortSignal;
  /** 由运行自己中止，带上原因（#1073）；已中止时不改原因。 */
  abort(reason?: unknown): void;
  /** 运行结束：摘掉监听。之后根再中止，这次运行不再跟着中止。 */
  end(): void;
}

export interface TranslationRuns {
  /** 从 root 派生一次运行；extra 是调用方自己的信号。 */
  begin(root: RunRoot, extra?: AbortSignal): TranslationRun;
  /** 还原整页：中止页面根，并换一个新的页面根。输入根不受影响。 */
  restorePage(): void;
}

export function createTranslationRuns(): TranslationRuns {
  let page = new AbortController();
  const input = new AbortController();

  return {
    begin(root, extra) {
      const own = new AbortController();
      const sources = [root === 'page' ? page.signal : input.signal, ...(extra ? [extra] : [])];
      const onAbort = () => own.abort();
      const end = () => {
        for (const s of sources) s.removeEventListener('abort', onAbort);
      };
      if (sources.some((s) => s.aborted)) own.abort();
      else for (const s of sources) s.addEventListener('abort', onAbort, { once: true });
      return { signal: own.signal, abort: (reason) => own.abort(reason), end };
    },

    restorePage() {
      const old = page;
      page = new AbortController();
      old.abort();
    },
  };
}
