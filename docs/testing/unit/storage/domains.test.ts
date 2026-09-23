/**
 * storage/domains.ts — 领域存储与当前领域解析 单元测试（#379）
 *
 * 只断言外部可观察的行为：生效领域列表的内容、给定网址与目标语言时
 * 解析出的当前领域。
 */
import { describe, test, expect } from 'vitest';
import { getEffectiveDomains, currentDomain } from '~/src/storage/domains';
import type { Domain } from '~/src/storage/domains';

function domain(id: string, sites: string[], targetLang = 'zh-CN'): Domain {
  return { id, name: id, targetLang, sites, terms: [], origin: 'user' };
}

describe('getEffectiveDomains — 生效领域列表', () => {
  test('只含内置领域「软件开发(简体中文)」', async () => {
    const domains = await getEffectiveDomains();
    expect(domains).toHaveLength(1);
    const [dev] = domains;
    expect(dev!.origin).toBe('builtin');
    expect(dev!.name).toBe('软件开发(简体中文)');
    expect(dev!.targetLang).toBe('zh-CN');
    expect(dev!.sites).toEqual(expect.arrayContaining(['github.com', 'gitlab.com']));
    expect(dev!.terms.length).toBeGreaterThan(0);
  });

  test('内置术语：「不翻译」无需译法，其余都给出译法', async () => {
    const [dev] = await getEffectiveDomains();
    for (const t of dev!.terms) {
      expect(t.source.trim()).not.toBe('');
      if (!t.noTranslate) expect(t.target?.trim()).toBeTruthy();
    }
    expect(dev!.terms.find((t) => t.source === 'issue')?.noTranslate).toBe(true);
  });

  test('调用方改动返回值不影响下一次读取', async () => {
    const first = await getEffectiveDomains();
    first[0]!.sites.push('example.com');
    first[0]!.terms.length = 0;
    const second = await getEffectiveDomains();
    expect(second[0]!.sites).not.toContain('example.com');
    expect(second[0]!.terms.length).toBeGreaterThan(0);
  });
});

describe('currentDomain — 当前领域解析', () => {
  test('内置领域在 github.com 与其子域上命中', async () => {
    const domains = await getEffectiveDomains();
    expect(currentDomain(domains, 'github.com', 'zh-CN')?.id).toBe(domains[0]!.id);
    expect(currentDomain(domains, 'gist.github.com', 'zh-CN')?.id).toBe(domains[0]!.id);
    expect(currentDomain(domains, 'www.gitlab.com', 'zh-CN')?.id).toBe(domains[0]!.id);
  });

  test('网址未命中任何领域 → null', async () => {
    const domains = await getEffectiveDomains();
    expect(currentDomain(domains, 'example.com', 'zh-CN')).toBeNull();
  });

  test('沿用站点名单的裸域名语义：IP 只做精确匹配', () => {
    const domains = [domain('lan', ['192.168.1.1'])];
    expect(currentDomain(domains, '192.168.1.1', 'zh-CN')?.id).toBe('lan');
    expect(currentDomain(domains, '10.192.168.1.1', 'zh-CN')).toBeNull();
  });

  test('多个领域同时命中 → 取列表中第一个', () => {
    const domains = [
      domain('a', ['example.com']),
      domain('b', ['docs.example.com']),
    ];
    expect(currentDomain(domains, 'docs.example.com', 'zh-CN')?.id).toBe('a');
    expect(currentDomain([...domains].reverse(), 'docs.example.com', 'zh-CN')?.id).toBe('b');
  });

  test('目标语言与领域不一致 → 不启用该领域', async () => {
    const domains = await getEffectiveDomains();
    expect(currentDomain(domains, 'github.com', 'ja')).toBeNull();
    expect(currentDomain(domains, 'github.com', 'zh-TW')).toBeNull();
  });

  test('语言不一致的领域被跳过，继续取后面命中且语言一致的领域', () => {
    const domains = [
      domain('zh', ['github.com'], 'zh-CN'),
      domain('ja', ['github.com'], 'ja'),
    ];
    expect(currentDomain(domains, 'github.com', 'ja')?.id).toBe('ja');
  });

  test('语言码比对不区分大小写', () => {
    const domains = [domain('zh', ['github.com'], 'zh-CN')];
    expect(currentDomain(domains, 'github.com', 'zh-cn')?.id).toBe('zh');
  });
});
