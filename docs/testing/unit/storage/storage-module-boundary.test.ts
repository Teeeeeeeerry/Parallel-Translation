/**
 * 领域与站点页面规则两个存储模块互不 import（ADR-0004、#1152）
 *
 * 两边共用的写入链、加锁、三种读取收在“带锁 local 存储记录”（locked-record）
 * 里，各建一个实例；共用逻辑是第三个模块，两个存储模块之间没有依赖。领域那边
 * 拆出的术语 CSV 与内置领域叠加层同样不碰站点页面规则。
 */
import { describe, test, expect } from 'vitest';
import fs from 'fs';

const importsOf = (file: string) =>
  [...fs.readFileSync(`src/storage/${file}`, 'utf-8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);

describe('存储模块的边界', () => {
  test('domains 与 specialization 互不 import，两边都用 locked-record', () => {
    expect(importsOf('domains.ts').filter((p) => p.includes('specialization'))).toEqual([]);
    expect(importsOf('specialization.ts').filter((p) => p.includes('domains'))).toEqual([]);
    expect(importsOf('domains.ts')).toContain('./locked-record');
    expect(importsOf('specialization.ts')).toContain('./locked-record');
  });

  test('术语 CSV、内置领域叠加层、locked-record 不 import 站点页面规则', () => {
    for (const f of ['terms-csv.ts', 'builtin-overlay.ts', 'locked-record.ts']) {
      expect(importsOf(f).filter((p) => p.includes('specialization')), f).toEqual([]);
    }
  });
});
