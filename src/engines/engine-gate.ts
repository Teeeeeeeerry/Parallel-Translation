// 引擎级并发闸门 —— #159。
//
// 整页翻译的所有批次在 content 侧并发发出（Promise.all），每个引擎的
// translate() 会被并发调用多次。此前只有 google-web 有模块级惰性单例
// 闸门（逐文本限流），bing-edge / deepl / openai / gemini 都是裸 fetch：
// Bing 易 429 整批降级、付费 LLM 并发付费调用费用放大、DeepL 免费版
// 对并发敏感。
//
// 此模块把闸门提升为引擎公共层：每个引擎模块加载时调一次 engineGate()，
// 得到模块级惰性单例的获取函数 —— 跨所有调用共享，上限随设置动态调整。

import { createGate } from '~/src/queue/concurrency';
import { getSettings, onSettingsChanged } from '~/src/storage/settings';

/**
 * 返回引擎的惰性闸门获取函数。
 *
 * 上限推迟到首次翻译时读取，避免模块 import 时设置尚未加载；设置变更
 * 时调 setMax 改上限，保留当前 active 计数与等待队列，避免 gate=null
 * 重建导致两个闸门并发翻倍。
 */
export function engineGate(): () => ReturnType<typeof createGate> {
  let gate: ReturnType<typeof createGate> | null = null;
  onSettingsChanged(() => {
    if (gate) gate.setMax(getSettings().maxConcurrency);
    else gate = createGate(getSettings().maxConcurrency);
  });
  return () => (gate ??= createGate(getSettings().maxConcurrency));
}
