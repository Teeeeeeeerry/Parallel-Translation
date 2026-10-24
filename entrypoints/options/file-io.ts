// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Parallel-Translation contributors
//
// 本文件是 Parallel-Translation 的一部分，依 GNU GPL v3 或更新版本发布，
// 不含任何担保。完整条款见仓库根目录的 LICENSE。

// 设置页共用的导入导出函数（#1124，父 #1115）。
//
// 领域、站点页面规则、高级三个分区的导入是同一个流程：隐藏的文件输入框、选完
// 清空 value、读文件、解析、跳过的条目最多列 20 条再写“另有 N 条”、给用户看的
// 结果提示。各分区只写自己的解析与写入；读文件统一用 Blob.text()，读取失败与
// 存储配额错误统一给出提示。导出同样经这里（生成文件并下载）。
//
// 存储层不动（ADR-0004）：两个存储模块的导入导出“文案与交互对齐靠设置页共用的
// 函数”，就是这一组。不依赖 main.ts，可以单独在 jsdom 里测。

import { tf } from '~/src/i18n';
import { StorageQuotaError } from '~/src/storage/quota';
import { StorageReadError } from '~/src/storage/read-error';

/** 导入报告最多逐条列出的跳过条目数，其余合并成一行（#378）。 */
export const SKIP_LIST_MAX = 20;

/**
 * 给用户看的失败原因：去掉内部日志用的“[PT] ”前缀；存储空间不足时说明
 * 办法（#510）；存储读取失败时按界面语言显示（#588，错误本身的文字只给日志用）。
 * 设置页各分区的失败提示都用它（#528）。
 */
export function failReason(e: unknown): string {
  if (e instanceof StorageQuotaError) {
    return tf('domainStorageFull', '存储空间不足，可以在“高级”分区点“清空缓存”后重试');
  }
  if (e instanceof StorageReadError) {
    return tf('domainStorageReadFailed', '暂时读不到存储里的数据，请稍后重试');
  }
  return (e instanceof Error ? e.message : String(e)).replace(/^\[PT\]\s*/, '');
}

/**
 * 跳过条目的报告：每条一行，最多列 SKIP_LIST_MAX 条，其余合并成一行“另有 N 条”
 * （more 收到剩下的条数）。没有跳过的时为空字符串。
 */
export function skipReport<T>(
  skipped: readonly T[],
  line: (skip: T) => string,
  more: (rest: string) => string,
): string {
  const lines = skipped.slice(0, SKIP_LIST_MAX).map(line);
  if (skipped.length > SKIP_LIST_MAX) lines.push(more(String(skipped.length - SKIP_LIST_MAX)));
  return lines.join('\n');
}

/**
 * 把隐藏的文件输入框接到按钮上：点按钮打开选择；选完先清空 value（再次选同一个
 * 文件也会触发 change），再把文件交给 onFile。取消选择时什么都不做。
 */
export function wireFileImport(
  button: HTMLElement,
  input: HTMLInputElement,
  onFile: (file: File) => void,
): void {
  button.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) onFile(file);
  });
}

/** 读文件失败（文件被移走、被占用、权限不够）。 */
class FileReadError extends Error {
  constructor(cause: unknown) {
    super('[PT] 读取导入文件失败', { cause });
    this.name = 'FileReadError';
  }
}

export type ImportOutcome<R> = { ok: true; value: R } | { ok: false; message: string };

/**
 * 导入一个文件：读出文字交给 parse（调用方的解析与写入），返回它的结果，或给
 * 用户看的失败提示。failure 可以把调用方自己认得的错误换成专门的提示（例如
 * “文件不是站点规则导出文件”）；返回 null 时用通用提示 ——
 * 读不出文件：“导入失败：读不出这个文件……”；其他错误：“导入失败：原因”
 * （存储配额用完时原因是“可以在高级分区清空缓存”）。
 */
export async function importFile<R>(
  file: Blob,
  parse: (text: string) => Promise<R>,
  opts: { failure?: (e: unknown) => string | null } = {},
): Promise<ImportOutcome<R>> {
  try {
    const text = await file.text().catch((e: unknown) => {
      throw new FileReadError(e);
    });
    return { ok: true, value: await parse(text) };
  } catch (e) {
    console.error('[PT] 导入失败:', e);
    if (e instanceof FileReadError) {
      return {
        ok: false,
        message: tf('importReadFailed', '导入失败：读不出这个文件，请确认文件还在、没有被别的程序占用'),
      };
    }
    const own = opts.failure?.(e);
    if (own) return { ok: false, message: own };
    const reason = failReason(e);
    return { ok: false, message: tf('importFailed', `导入失败：${reason}`, reason) };
  }
}

/** 下载开始之后多久释放临时链接（#494）。 */
const REVOKE_DELAY_MS = 60_000;

/**
 * 把文本存成文件并触发下载（#494）。设置页的各个导出都用它。
 *
 * 临时链接延后释放：Chrome 在触发下载时已经取到文件，但 Firefox 的下载
 * 异步开始，同一时刻释放可能导致下载失败或得到空文件。FileSaver.js 同样
 * 延后几十秒才释放。
 */
export function downloadFile(content: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
