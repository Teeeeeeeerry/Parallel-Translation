/**
 * storage/builtin-domains.ts — 内置领域数据 单元测试
 *
 * 只断言外部可观察的数据约束：内置领域由「软件开发(简体中文)」（本项目自编）
 * 与按术语库生成的内置领域组成（脚本见 scripts/build-builtin-domains.ts）。
 * 这里钉住领域标识、目标语言、术语形状、同一领域内原词不重复、适用网址是
 * 裸域名，以及几条代表性的术语与网址解析；生成出来的数据改错了会在这里红。
 *
 * 术语匹配本身见 engines/terms 的用例；叠加层与排序见各自的用例。
 */
import { describe, test, expect } from 'vitest';
import { BUILTIN_DOMAINS } from '~/src/storage/builtin-domains';
import { currentDomain } from '~/src/storage/domains';
import { LANG_LIST } from '~/src/storage/schema';
import type { Domain } from '~/src/storage/domains';

const byId = (id: string): Domain => {
  const d = BUILTIN_DOMAINS.find((x) => x.id === id);
  expect(d, `缺少内置领域 ${id}`).toBeDefined();
  return d!;
};

const termOf = (domainId: string, source: string) => {
  const t = byId(domainId).terms.find((x) => x.source.toLowerCase() === source.toLowerCase());
  expect(t, `${domainId} 缺少术语 ${source}`).toBeDefined();
  return t!;
};

const LANG_CODES = LANG_LIST.map((l) => l.code);

describe('内置领域的形状', () => {
  test('ID 唯一、都标为内置、目标语言在语言表里且不是 auto', () => {
    const ids = BUILTIN_DOMAINS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of BUILTIN_DOMAINS) {
      expect(d.id.startsWith('builtin:')).toBe(true);
      expect(d.origin).toBe('builtin');
      expect(LANG_CODES).toContain(d.targetLang);
      expect(d.targetLang).not.toBe('auto');
      expect(d.terms.length).toBeGreaterThan(0);
    }
  });

  test('领域名唯一，且带上目标语言后缀', () => {
    const names = BUILTIN_DOMAINS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    for (const d of BUILTIN_DOMAINS) {
      const suffix = d.targetLang === 'zh-TW' ? '(繁體中文)' : '(简体中文)';
      expect(d.name.endsWith(suffix), `${d.id}: ${d.name}`).toBe(true);
    }
  });

  test('术语：原词非空且没有首尾空白，译法与“不翻译”二选一', () => {
    for (const d of BUILTIN_DOMAINS) {
      for (const t of d.terms) {
        expect(t.source, d.id).toBe(t.source.trim());
        expect(t.source.length, d.id).toBeGreaterThan(0);
        const noTranslate = t.noTranslate === true;
        const target = t.target ?? '';
        expect(noTranslate || target.trim() !== '', `${d.id}: ${t.source}`).toBe(true);
        if (noTranslate) expect(t.target, `${d.id}: ${t.source}`).toBeUndefined();
        else expect(target, `${d.id}: ${t.source}`).toBe(target.trim());
      }
    }
  });

  test('同一领域里原词不重复（不区分大小写，与匹配口径一致）', () => {
    for (const d of BUILTIN_DOMAINS) {
      const seen = new Set<string>();
      for (const t of d.terms) {
        const key = t.source.trim().toLowerCase();
        expect(seen.has(key), `${d.id} 原词重复：${t.source}`).toBe(false);
        seen.add(key);
      }
    }
  });

  test('适用网址是裸域名：小写、没有协议 / 路径 / 通配符，同一领域不重复', () => {
    for (const d of BUILTIN_DOMAINS) {
      const seen = new Set<string>();
      for (const s of d.sites) {
        expect(s, d.id).toBe(s.trim().toLowerCase());
        expect(s, `${d.id}: ${s}`).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/);
        expect(seen.has(s), `${d.id} 网址重复：${s}`).toBe(false);
        seen.add(s);
      }
    }
  });
});

describe('内置领域的收录范围', () => {
  test('63 个内置领域：35 个简体、27 个繁体加自编的软件开发领域', () => {
    expect(BUILTIN_DOMAINS).toHaveLength(63);
    expect(BUILTIN_DOMAINS.filter((d) => d.targetLang === 'zh-CN')).toHaveLength(36);
    expect(BUILTIN_DOMAINS.filter((d) => d.targetLang === 'zh-TW')).toHaveLength(27);
  });

  test('35 个有翻译词表的术语库都进了内置领域；只有 auto 词表没有独立领域', () => {
    const ids = new Set(BUILTIN_DOMAINS.map((d) => d.id));
    const glossaries = [
      'access-control', 'ao3', 'bg3', 'biology', 'car', 'chess', 'ecommerce', 'education',
      'fashion', 'finance', 'food', 'game', 'gardening', 'golf', 'hd2', 'legal', 'medical',
      'movie', 'music', 'news', 'packraft', 'pet', 'photography', 'programming',
      'programming-contest', 'shelter69-slang', 'sports', 'stellar-blade-clothing', 'tech',
      'tennis', 'travel', 'twitter', 'vocaloid', 'web3', 'wuthering-waves',
    ];
    for (const g of glossaries) {
      expect(ids, `缺少术语库 ${g} 的简体领域`).toContain(`builtin:${g}-zh-CN`);
    }
    // 只有这种简繁都有的词表才有繁体领域；单语言词表不生成
    for (const g of ['ao3', 'bg3', 'legal', 'medical', 'programming-contest', 'tennis', 'twitter']) {
      expect(ids, `缺少术语库 ${g} 的繁体领域`).toContain(`builtin:${g}-zh-TW`);
    }
    for (const g of ['access-control', 'biology', 'hd2', 'packraft', 'shelter69-slang', 'stellar-blade-clothing', 'vocaloid', 'wuthering-waves']) {
      expect(ids.has(`builtin:${g}-zh-TW`), `单语言词表 ${g} 不该有繁体领域`).toBe(false);
    }
    // auto 词表（default）并进技术领域，不单独成为领域
    expect(ids.has('builtin:default-zh-CN')).toBe(false);
  });

  test('术语总数：简体 3,718 条、繁体 1,802 条，合计 5,520 条', () => {
    const total = (lang: string) =>
      BUILTIN_DOMAINS.filter((d) => d.targetLang === lang).reduce((n, d) => n + d.terms.length, 0);
    expect(total('zh-CN')).toBe(3718);
    expect(total('zh-TW')).toBe(1802);
    expect(total('zh-CN') + total('zh-TW')).toBe(5520);
  });
});

describe('代表性的术语与适用网址', () => {
  test('指定译法按术语库的语言分别给出简繁译法', () => {
    expect(termOf('builtin:legal-zh-CN', 'Constitution').target).toBe('宪法');
    expect(termOf('builtin:legal-zh-TW', 'Constitution').target).toBe('憲法');
    expect(termOf('builtin:tech-zh-CN', 'Algorithm').target).toBe('算法');
    expect(termOf('builtin:tech-zh-TW', 'Algorithm').target).toBe('演算法');
    expect(termOf('builtin:bg3-zh-CN', 'Shadowheart').target).toBe('影心');
    expect(termOf('builtin:bg3-zh-TW', 'Gale').target).toBe('蓋爾');
  });

  test('auto 词表并进对应领域后是“不翻译”', () => {
    expect(termOf('builtin:tech-zh-CN', 'GPT').noTranslate).toBe(true);
    expect(termOf('builtin:game-zh-CN', 'Steam').noTranslate).toBe(true);
    expect(termOf('builtin:programming-zh-CN', 'Python').noTranslate).toBe(true);
    expect(termOf('builtin:web3-zh-TW', 'Bitcoin').noTranslate).toBe(true);
    expect(termOf('builtin:tech-zh-CN', 'LLM').noTranslate).toBe(true);
  });

  test('译法与原文相同的术语按“不翻译”存', () => {
    expect(termOf('builtin:shelter69-slang-zh-CN', 'MP3').noTranslate).toBe(true);
    expect(termOf('builtin:packraft-zh-CN', 'TPU').noTranslate).toBe(true);
  });

  test('站点本身就用这套词的内置领域按裸域名自动命中', () => {
    expect(currentDomain(BUILTIN_DOMAINS, 'bg3.wiki', 'zh-CN')?.id).toBe('builtin:bg3-zh-CN');
    expect(currentDomain(BUILTIN_DOMAINS, 'www.bg3.wiki', 'zh-TW')?.id).toBe('builtin:bg3-zh-TW');
    expect(currentDomain(BUILTIN_DOMAINS, 'codeforces.com', 'zh-CN')?.id).toBe(
      'builtin:programming-contest-zh-CN',
    );
    expect(currentDomain(BUILTIN_DOMAINS, 'atcoder.jp', 'zh-TW')?.id).toBe(
      'builtin:programming-contest-zh-TW',
    );
    expect(currentDomain(BUILTIN_DOMAINS, 'x.com', 'zh-CN')?.id).toBe('builtin:twitter-zh-CN');
    expect(currentDomain(BUILTIN_DOMAINS, 'wuthering.gg', 'zh-CN')?.id).toBe(
      'builtin:wuthering-waves-zh-CN',
    );
    expect(currentDomain(BUILTIN_DOMAINS, 'github.com', 'zh-CN')?.id).toBe('builtin:software-zh-CN');
  });

  test('目标语言不同的领域不启用；宽泛站点与未收录站点不自动命中', () => {
    // 术语库只有简体：繁体目标语言下没有可用的领域
    expect(currentDomain(BUILTIN_DOMAINS, 'bg3.wiki', 'zh-CN')?.targetLang).toBe('zh-CN');
    expect(currentDomain(BUILTIN_DOMAINS.filter((d) => d.targetLang === 'zh-CN'), 'bg3.wiki', 'zh-TW')).toBeNull();
    // 生物词表原配的 wikipedia 太宽泛（class / order / family 会被误伤），不收
    expect(currentDomain(BUILTIN_DOMAINS, 'wikipedia.org', 'zh-CN')).toBeNull();
    expect(currentDomain(BUILTIN_DOMAINS, 'example.com', 'zh-CN')).toBeNull();
  });
});
