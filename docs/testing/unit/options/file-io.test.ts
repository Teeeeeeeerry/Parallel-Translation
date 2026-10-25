/**
 * 设置页共用的导入导出函数（#1124，父 #1115）
 *
 * 领域、站点页面规则、高级三个分区的导入都走这一组：隐藏的文件输入框、读文件、
 * 调用方给的解析、跳过行汇总（最多列 20 条，再写“另有 N 条”）、读取失败与存储
 * 配额错误的提示。只看外部行为：给定文件内容和解析函数，报告文本与结果是什么。
 */
import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadUiLocale, type MessageTable, type UiLocale } from '~/src/i18n';
import {
  importFile,
  skipReport,
  SKIP_LIST_MAX,
  wireFileImport,
  failReason,
} from '~/entrypoints/options/file-io';
import { StorageQuotaError } from '~/src/storage/quota';

// 按简体中文的取文表取文，提示里看得到原因
beforeAll(async () => {
  await loadUiLocale('zh_CN', async (locale: UiLocale) =>
    JSON.parse(fs.readFileSync(path.resolve('public/_locales', locale, 'messages.json'), 'utf-8')) as MessageTable,
  );
});
afterAll(async () => {
  await loadUiLocale('browser');
});

/** 一个读出给定文字的“文件”；text 为 Error 时读取失败 */
const file = (text: string | Error) =>
  ({ text: () => (text instanceof Error ? Promise.reject(text) : Promise.resolve(text)) }) as unknown as File;

/** 解析：JSON 数组，每个元素是数字就导入，否则跳过 */
const parseNumbers = async (text: string) => {
  const data = JSON.parse(text) as unknown[];
  const imported = data.filter((x) => typeof x === 'number').length;
  const skipped = data.flatMap((x, i) => (typeof x === 'number' ? [] : [{ line: i + 1 }]));
  return { imported, skipped };
};
const line = (s: { line: number }) => `第 ${s.line} 行：不是数字`;
const more = (n: string) => `另有 ${n} 行没有导入`;

describe('导入文件（#1124）', () => {
  test('部分跳过：导入了几条、跳过哪些（少于 20 条时全部列出）', async () => {
    const r = await importFile(file('[1, "a", 2, null]'), parseNumbers);
    expect(r).toEqual({ ok: true, value: { imported: 2, skipped: [{ line: 2 }, { line: 4 }] } });
    if (!r.ok) return;
    expect(skipReport(r.value.skipped, line, more)).toBe('第 2 行：不是数字\n第 4 行：不是数字');
  });

  test('跳过多于 20 条：只列前 20 条，再写“另有 N 条”', () => {
    const skipped = Array.from({ length: 23 }, (_, i) => ({ line: i + 1 }));
    const lines = skipReport(skipped, line, more).split('\n');
    expect(lines).toHaveLength(SKIP_LIST_MAX + 1);
    expect(SKIP_LIST_MAX).toBe(20);
    expect(lines[19]).toBe('第 20 行：不是数字');
    expect(lines[20]).toBe('另有 3 行没有导入');
  });

  test('恰好 20 条：全部列出，没有“另有”', () => {
    const skipped = Array.from({ length: 20 }, (_, i) => ({ line: i + 1 }));
    expect(skipReport(skipped, line, more).split('\n')).toHaveLength(20);
  });

  test('全部跳过：导入 0 条，跳过的都在报告里', async () => {
    const r = await importFile(file('["a", "b"]'), parseNumbers);
    expect(r).toMatchObject({ ok: true, value: { imported: 0 } });
    if (r.ok) expect(skipReport(r.value.skipped, line, more).split('\n')).toHaveLength(2);
  });

  test('没有跳过：报告是空的', () => {
    expect(skipReport([], line, more)).toBe('');
  });

  test('坏 JSON：解析抛错，给出导入失败的提示与原因', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let thrown: unknown;
    const r = await importFile(file('{oops'), async (text) => {
      try {
        return await parseNumbers(text);
      } catch (e) {
        thrown = e;
        throw e;
      }
    });
    expect(thrown).toBeInstanceOf(SyntaxError);
    expect(r).toEqual({ ok: false, message: `导入失败：${failReason(thrown)}` });
    error.mockRestore();
  });

  test('空文件：交给解析，解析说不行就是导入失败（不是读取失败）', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: string[] = [];
    const r = await importFile(file(''), async (text) => {
      seen.push(text);
      throw new Error('[PT] 文件是空的');
    });
    expect(seen).toEqual(['']);
    expect(r).toEqual({ ok: false, message: '导入失败：文件是空的' });
    error.mockRestore();
  });

  test('解析函数可以自己给出失败提示（例如“不是站点规则导出文件”）', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await importFile(file('{}'), async () => {
      throw new Error('format');
    }, { failure: (e) => (e instanceof Error && e.message === 'format' ? '导入失败：文件格式不对' : null) });
    expect(r).toEqual({ ok: false, message: '导入失败：文件格式不对' });
    error.mockRestore();
  });

  test('文件读不出来：给出读取失败的提示，解析不会被调用', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const parse = vi.fn(parseNumbers);
    const r = await importFile(file(new Error('NotReadableError: The requested file could not be read')), parse);
    expect(r).toEqual({ ok: false, message: '导入失败：读不出这个文件，请确认文件还在、没有被别的程序占用' });
    expect(parse).not.toHaveBeenCalled();
    error.mockRestore();
  });

  test('写入时存储配额用完：提示可以在高级分区清空缓存', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await importFile(file('[1]'), async () => {
      throw new StorageQuotaError(new Error('QUOTA_BYTES quota exceeded'));
    });
    expect(r).toEqual({ ok: false, message: '导入失败：存储空间不足，可以在“高级”分区点“清空缓存”后重试' });
    error.mockRestore();
  });
});

describe('文件输入框接线（#1124）', () => {
  test('点按钮打开选择；选完清空 value，同一个文件再选一次照样触发', () => {
    document.body.innerHTML = '<button id="b"></button><input type="file" id="f" hidden />';
    const button = document.getElementById('b')!;
    const input = document.getElementById('f') as HTMLInputElement;
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    const got: File[] = [];
    wireFileImport(button, input, (f) => got.push(f));

    button.click();
    expect(click).toHaveBeenCalledTimes(1);

    const picked = new File(['[1]'], 'a.json');
    Object.defineProperty(input, 'files', { configurable: true, get: () => [picked] });
    let value = 'C:\\fakepath\\a.json';
    Object.defineProperty(input, 'value', { configurable: true, get: () => value, set: (v) => (value = v) });
    input.dispatchEvent(new Event('change'));
    input.dispatchEvent(new Event('change'));
    expect(got).toEqual([picked, picked]);
    expect(value).toBe('');
  });

  test('没选文件（取消）：什么都不做', () => {
    document.body.innerHTML = '<button id="b"></button><input type="file" id="f" hidden />';
    const input = document.getElementById('f') as HTMLInputElement;
    const onFile = vi.fn();
    wireFileImport(document.getElementById('b')!, input, onFile);
    input.dispatchEvent(new Event('change'));
    expect(onFile).not.toHaveBeenCalled();
  });
});
