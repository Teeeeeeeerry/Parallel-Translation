/**
 * 切批闸值的上下界（#1006，依据见 docs/research/batch-char-budget.md）
 *
 * 不断言闸值等于几，只断言它落在实测给出的界内：
 *   - 个数上限：一批大致独占一条引擎通道（content 侧闸门 #1007），Google 一条文本
 *     一个请求，单批耗时约等于条数乘单次请求耗时。慢网下单次请求按 1 秒算，一批
 *     要在引擎时段超时之内翻完（#1071 起超时从拿到引擎许可起计，见 inflight）；
 *   - 个数上限不超过 DeepL 单次 50 条、Bing 单次 1000 条；
 *   - 字符预算不超过 Bing 单次 50000 字符（超了回 400，整批失败）。
 */
import { describe, test, expect } from 'vitest';
import { FULL_PAGE_BATCH_LIMITS } from '~/src/orchestration/orchestrator';
import { ENGINE_PHASE_TIMEOUT_MS } from '~/src/runtime/inflight';

/** 慢网下 Google 单次请求的耗时（实测正常约 470 毫秒，按两倍多留余量） */
const SLOW_REQUEST_MS = 1000;

describe('切批闸值落在实测给出的界内（#1006）', () => {
  test('个数上限乘慢网单次请求耗时，小于引擎时段超时', () => {
    expect(FULL_PAGE_BATCH_LIMITS.maxItems * SLOW_REQUEST_MS).toBeLessThan(ENGINE_PHASE_TIMEOUT_MS);
  });

  test('个数上限不超过 DeepL 单次 50 条与 Bing 单次 1000 条', () => {
    expect(FULL_PAGE_BATCH_LIMITS.maxItems).toBeLessThanOrEqual(50);
    expect(FULL_PAGE_BATCH_LIMITS.maxItems).toBeLessThanOrEqual(1000);
  });

  test('字符预算不超过 Bing 单次 50000 字符', () => {
    expect(FULL_PAGE_BATCH_LIMITS.maxChars).toBeLessThanOrEqual(50_000);
  });
});
