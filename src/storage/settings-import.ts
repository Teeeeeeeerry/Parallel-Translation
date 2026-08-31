// 设置导入 —— 整体替换语义（#324）。
//
// 导入此前走 patchSettings（逐键合并）：导入一份不含自定义模型名的
// 配置时，本机原有的模型名会残留 —— 用户以为同步了配置，实际翻译
// 打到的还是旧模型。本模块把导入改为与恢复默认一致的整体替换：
//   1. 白名单字段 + 既有校验（并发钳制 / 自定义 CSS 校验 / 剔除密钥）
//   2. 缺省或 null 的字段回落到默认值
//   3. 嵌套键（models / siteList / hotkeys）整体覆盖 —— 策略声明表
//      NESTED_KEYS 仍是唯一声明处，本模块不硬编码任何键名
// 解析与构建是纯函数（parseImport），可独立单测；写盘只经 replaceSettings。

import type { Settings } from './schema';
import { DEFAULT_SETTINGS, clampConcurrency } from './schema';
import { validateCustomCss } from '~/src/styles/custom';
import { replaceSettings } from './settings';

export type ImportResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * 解析并校验导入 JSON，构建完整替换对象（纯函数，不写存储）。
 * 返回 ok=false 时调用方不应写盘。
 */
export function parseImport(
  json: string,
): { ok: true; settings: Settings } | { ok: false; reason: string } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'JSON 格式无效' };
  }
  // 非对象（数组 / 基本类型）视为无效 —— 整体替换语义下绝不能
  // 把合法但形状错误的 JSON 解析成「空配置」把本机设置冲掉
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, reason: 'JSON 格式无效' };
  }

  const rec = data as Record<string, unknown>;
  // 白名单校验：只允许已知 Setting 字段，未知字段被丢弃；
  // null 值视为缺省（整体替换语义下回落默认，不污染配置）
  const allowed = Object.keys(DEFAULT_SETTINGS);
  const next: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in rec && rec[key] !== null) next[key] = rec[key];
  }
  // #172: 值校验 —— 导入文件可绕过 UI 下拉，maxConcurrency 必须钳制，
  // 否则 0/负数会让 Google 闸门永久饿死、全部翻译挂起
  if (typeof next.maxConcurrency === 'number') {
    next.maxConcurrency = clampConcurrency(next.maxConcurrency);
  }
  // #168: 导入同样走统一校验器 —— 否则 @import/url() 等可通过导入
  // 绕过表单校验，运行时注入被拒后旧样式还被清掉
  if (typeof next.customCss === 'string') {
    const cssResult = validateCustomCss(next.customCss);
    if (!cssResult.ok) return { ok: false, reason: cssResult.msg };
  }
  // 显式移除任何密钥相关字段
  delete next.apiKeys;

  // #324: 整体替换语义 —— 缺省字段回落到默认值；嵌套键整体覆盖
  // （导入不含自定义模型名的配置时本机模型名被清除，不残留）。
  // 嵌套键策略只声明在 NESTED_KEYS 一处，由 replaceSettings 消费；
  // 这里只做整对象替换，不硬编码任何键名
  const complete = { ...DEFAULT_SETTINGS, ...next } as Settings;
  return { ok: true, settings: complete };
}

/** 导入设置：解析校验 → 整体替换写盘。 */
export async function importSettings(json: string): Promise<ImportResult> {
  const parsed = parseImport(json);
  if (!parsed.ok) return parsed;
  await replaceSettings(parsed.settings);
  return { ok: true };
}
