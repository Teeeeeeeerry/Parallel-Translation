// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 引擎表（#1154，父 #1142）：生产代码交给路由的默认引擎表。
//
// 原先写死在路由模块里，路由测试没法注入，只能各自 mock 七个引擎模块。现在
// 引擎表是 route() 的参数，后台传这一份，测试传两三个假引擎。

import type { EngineId } from '~/src/storage/schema';
import { googleWeb } from './google-web';
import { bingEdge } from './bing-edge';
import { openai } from './openai';
import { deepl } from './deepl';
import { gemini } from './gemini';
import { deepseek } from './deepseek';
import { grok } from './grok';
import type { TranslateEngine } from './types';

/** 路由用的引擎表：按引擎 id 找适配器；表里没有的引擎在优先级里跳过。 */
export type EngineTable = Partial<Record<EngineId, TranslateEngine>>;

/** 默认引擎表 —— 引擎清单（#608）里的每个引擎都要有适配器，缺项即类型错误。 */
export const ENGINES: Record<EngineId, TranslateEngine> = {
  'google-web': googleWeb,
  'bing-edge': bingEdge,
  'openai': openai,
  'deepl': deepl,
  'gemini': gemini,
  'deepseek': deepseek,
  'grok': grok,
};
