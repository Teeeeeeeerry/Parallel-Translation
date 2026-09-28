/**
 * storage/domains.ts — 当前领域的临时选择 单元测试（#400）
 *
 * 只断言外部可观察的行为：给定生效领域列表、顶层页面主机名、目标语言与
 * 用户在 popup 里的临时选择，解析出的当前领域。自动选择时与 #379 相同；
 * 选“无领域”时没有当前领域；指定领域时用它，即使网址不命中；指定的领域
 * 已被删除或不服务当前目标语言时退回自动选择。跨上下文传来的选择先经
 * 校验，形状不对的丢弃。
 */
import { describe, test, expect } from 'vitest';
import { currentDomain, parseDomainChoice } from '~/src/storage/domains';
import type { Domain } from '~/src/storage/domains';

function domain(id: string, sites: string[], targetLang = 'zh-CN'): Domain {
  return { id, name: id, targetLang, sites, terms: [], origin: 'user' };
}

const dev = domain('builtin:dev', ['github.com']);
const law = domain('user:law', ['example.com']);
const ja = domain('user:ja', ['github.com'], 'ja');
const list = [dev, law, ja];

describe('当前领域的临时选择（#400）', () => {
  test('自动选择：与不带选择时相同，按列表顺序取第一个命中的', () => {
    expect(currentDomain(list, 'github.com', 'zh-CN', { kind: 'auto' })?.id).toBe(dev.id);
    expect(currentDomain(list, 'news.org', 'zh-CN', { kind: 'auto' })).toBeNull();
  });

  test('选“无领域”：网址命中也没有当前领域', () => {
    expect(currentDomain(list, 'github.com', 'zh-CN', { kind: 'none' })).toBeNull();
  });

  test('指定领域：网址不命中也用它，并排在命中的领域之前', () => {
    expect(currentDomain(list, 'news.org', 'zh-CN', { kind: 'domain', id: law.id })?.id).toBe(law.id);
    expect(currentDomain(list, 'github.com', 'zh-CN', { kind: 'domain', id: law.id })?.id).toBe(law.id);
  });

  test('指定的领域已被删除 → 退回自动选择', () => {
    expect(
      currentDomain(list, 'github.com', 'zh-CN', { kind: 'domain', id: 'user:gone' })?.id,
    ).toBe(dev.id);
  });

  test('指定的领域不服务当前目标语言 → 退回自动选择', () => {
    expect(currentDomain(list, 'github.com', 'zh-CN', { kind: 'domain', id: ja.id })?.id).toBe(dev.id);
    expect(currentDomain(list, 'github.com', 'JA', { kind: 'domain', id: ja.id })?.id).toBe(ja.id);
  });
});

describe('临时选择的形状校验（#400）', () => {
  test('三种选择原样通过，多余字段丢弃', () => {
    expect(parseDomainChoice({ kind: 'auto' })).toEqual({ kind: 'auto' });
    expect(parseDomainChoice({ kind: 'none', id: 'x' })).toEqual({ kind: 'none' });
    expect(parseDomainChoice({ kind: 'domain', id: 'user:law', extra: 1 })).toEqual({
      kind: 'domain',
      id: 'user:law',
    });
  });

  test('形状不对返回 null', () => {
    for (const v of [undefined, null, 'auto', {}, { kind: 'other' }, { kind: 'domain' }, { kind: 'domain', id: 1 }]) {
      expect(parseDomainChoice(v)).toBeNull();
    }
  });
});
