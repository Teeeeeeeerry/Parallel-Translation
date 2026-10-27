// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 更新提示在 content script 侧的流程（#1172）。
//
// 本地预筛（decide.ts）→ 等页面可见 → 向后台申请显示权 → 渲染 → 用户看到后
// 写入已读并释放显示权。“看到”指在可见页面上被用户关闭，或持续可见满
// SEEN_AFTER_MS；没看到就切走或卸载，显示权释放，下一个可见页面再弹。
//
// 页面可见性、与后台的通信、渲染都由调用方注入，content.ts 只负责接线。

import type { ChangelogEntry } from './data';
import type { ClaimOutcome } from './claim';
import { decideShow, type ShowInput } from './decide';
import { markSeen } from './state';

/** 弹窗在可见页面上持续这么久即算用户看过。 */
export const SEEN_AFTER_MS = 3000;

/** 别的页面正占着显示权时，可见页面隔这么久再问一次。 */
export const BUSY_RETRY_MS = 1000;

export interface PromptPage {
  /** 页面此刻对用户可见：不是后台标签页，也不在预渲染。 */
  isVisible(): boolean;
  /** 可见性变化时回调，返回退订函数。 */
  onVisibilityChange(fn: () => void): () => void;
}

/** 拿到的显示权。用户看到后（已读写入之后）或没看成时都要释放。 */
export interface Lease {
  release(): void;
}

export type ClaimResult =
  | { granted: true; lease: Lease }
  | { granted: false; reason: Exclude<ClaimOutcome, 'granted'> };

export interface PromptDeps {
  input: ShowInput;
  page: PromptPage;
  /** 向后台申请显示权。抛错（SW 未就绪、扩展上下文失效）按这次不弹处理。 */
  claim(version: string): Promise<ClaimResult>;
  /**
   * 渲染弹窗（content.ts 经动态 import 载入弹窗模块，故为异步）。用户关闭时
   * 调 onClose；返回的函数移除弹窗而不调 onClose（页面切走时收起）。
   */
  render(entry: ChangelogEntry, onClose: () => void): Promise<() => void>;
}

/**
 * 启动更新提示流程，返回停止函数（content script 失效时调用）。
 */
export function startChangelogPrompt(deps: PromptDeps): () => void {
  const decision = decideShow(deps.input);
  if (!decision.show) return () => {};
  const { entry } = decision;

  /** waiting：等可见或等下次重试；claiming：申请中；showing：弹窗开着、还没算看过；done：结束。 */
  let phase: 'waiting' | 'claiming' | 'showing' | 'done' = 'waiting';
  let lease: Lease | null = null;
  let dismiss: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const unsubscribe = deps.page.onVisibilityChange(onVisibility);

  function finish(): void {
    phase = 'done';
    clearTimeout(timer);
    unsubscribe();
  }

  function releaseLease(): void {
    lease?.release();
    lease = null;
  }

  /** 还没算用户看过就得退回：收起弹窗（若有）、交还显示权，等下次可见。 */
  function backOff(remove?: () => void): void {
    clearTimeout(timer);
    remove?.();
    dismiss = null;
    releaseLease();
    phase = 'waiting';
  }

  async function tryClaim(): Promise<void> {
    phase = 'claiming';
    let result: ClaimResult;
    try {
      result = await deps.claim(entry.version);
    } catch {
      finish();
      return;
    }
    if (phase !== 'claiming') {
      // 申请期间被停止
      if (result.granted) result.lease.release();
      return;
    }
    if (!result.granted) {
      if (result.reason === 'seen') {
        finish();
        return;
      }
      // busy：占用者看完或释放后再问；切到后台就等下次可见
      phase = 'waiting';
      timer = setTimeout(() => {
        if (phase === 'waiting' && deps.page.isVisible()) void tryClaim();
      }, BUSY_RETRY_MS);
      return;
    }
    lease = result.lease;
    if (!deps.page.isVisible()) {
      // 申请期间切走了
      backOff();
      return;
    }
    let remove: () => void;
    try {
      remove = await deps.render(entry, onUserClose);
    } catch (e) {
      // 没显示出来：释放，让下一个页面弹；这个页面不再重试，免得反复失败
      releaseLease();
      finish();
      console.error('[PT] 更新提示失败：', e);
      return;
    }
    if (phase !== 'claiming') {
      // 渲染期间被停止
      remove();
      releaseLease();
      return;
    }
    if (!deps.page.isVisible()) {
      // 渲染期间切走了
      backOff(remove);
      return;
    }
    dismiss = remove;
    phase = 'showing';
    timer = setTimeout(() => void confirmSeen(), SEEN_AFTER_MS);
  }

  function onVisibility(): void {
    const visible = deps.page.isVisible();
    if (phase === 'waiting' && visible) {
      clearTimeout(timer);
      void tryClaim();
    } else if (phase === 'showing' && !visible) {
      // 还没算看过就切走
      backOff(dismiss ?? undefined);
    }
  }

  function onUserClose(): void {
    if (phase === 'showing') void confirmSeen();
  }

  async function confirmSeen(): Promise<void> {
    finish();
    // 先写已读再释放：别的页面拿到释放后的显示权时读到的已是已读
    try {
      await markSeen(entry.version);
    } catch (e) {
      console.error('[PT] 更新提示记为已读失败：', e);
    }
    releaseLease();
  }

  if (deps.page.isVisible()) void tryClaim();

  return () => {
    // content script 失效（扩展更新、重载）：还没算看过的弹窗一并收起 ——
    // 失效后写不了存储，留着它用户关掉也记不成已读
    if (phase === 'showing') dismiss?.();
    finish();
    releaseLease();
  };
}
