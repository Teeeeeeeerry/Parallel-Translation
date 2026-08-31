// 设置页测试连接 —— 统一走探测入口（#322）。
//
// 此前 openai 只查 401、deepl 只查 403，另一状态码会被显示成裸的
// HTTP 错误码；这里把两家引擎的测试连接收敛到公共探测入口
// probeConnection（#321），状态分类与翻译路径同一份口径：
// 401/403 → key 问题、429 → 配额、其余非 2xx → 瞬时。
// 本模块不持有任何 UI 依赖，可独立单测。

import { probeConnection } from './shared';
import { openaiProbe } from './openai';
import { deeplProbe } from './deepl';

/** 已接入探测入口的自带 key 引擎（gemini 见 #323）。 */
export type TestableKeyedEngine = 'openai' | 'deepl';

/** 测试连接结果 —— ok 与展示文案（文案已按失败类别区分）。 */
export interface TestConnectionResult {
  ok: boolean;
  msg: string;
}

/** 测试连接：构造最小请求 → 探测入口分类 → 返回结果（不写存储）。 */
export async function testConnection(
  engine: TestableKeyedEngine,
  key: string,
): Promise<TestConnectionResult> {
  const spec = engine === 'openai' ? openaiProbe : deeplProbe;
  const result = await probeConnection(spec, { key });
  return { ok: result.ok, msg: result.message };
}
