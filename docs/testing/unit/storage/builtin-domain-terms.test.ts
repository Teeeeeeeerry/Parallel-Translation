/**
 * 术语库内置领域 单元测试
 *
 * 9 个带译法的内置领域出现在生效领域列表里：术语能约束译文，ID 与名称
 * 不重复，按预置站点命中，并且不抢已有内置领域的站点；其余站点只能手选。
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { getEffectiveDomains, currentDomain, setDomainSites, type Domain } from '~/src/storage/domains';
import { siteMatches } from '~/src/dom/site-filter';
import { resetStorage } from '~/docs/testing/setup';

let domains: Domain[];
let termDomains: Domain[];

const byName = (name: string): Domain => {
  const d = domains.find((x) => x.name === name);
  expect(d, name).toBeDefined();
  return d!;
};

beforeEach(async () => {
  resetStorage();
  domains = await getEffectiveDomains();
  termDomains = domains.filter((d) => d.id.startsWith('builtin:terms-'));
});

describe('术语库内置领域', () => {
  test('共 9 个、523 条，都是简体中文的内置领域，排在已有内置领域之后', () => {
    expect(termDomains).toHaveLength(9);
    expect(termDomains.reduce((n, d) => n + d.terms.length, 0)).toBe(523);
    expect(termDomains.every((d) => d.origin === 'builtin' && d.targetLang === 'zh-CN')).toBe(true);
    expect(domains.slice(0, 3).some((d) => d.id.startsWith('builtin:terms-'))).toBe(false);
    expect(domains.slice(3)).toEqual(termDomains);
  });

  test('领域的 ID 与名称都不重复', () => {
    expect(new Set(domains.map((d) => d.id)).size).toBe(domains.length);
    expect(new Set(domains.map((d) => d.name)).size).toBe(domains.length);
  });

  test('每条术语都能约束译文，同一领域里原词不重复', () => {
    for (const d of termDomains) {
      for (const t of d.terms) {
        expect(t.source.trim(), d.name).toBe(t.source);
        expect(t.noTranslate === true || !!t.target?.trim(), `${d.name} 的 ${t.source}`).toBe(true);
      }
      const keys = d.terms.map((t) => t.source.toLowerCase());
      expect(new Set(keys).size, d.name).toBe(keys.length);
    }
  });

  test('译法与“不翻译”按术语库原样保留', () => {
    expect(byName('AO3(简体中文)').terms).toContainEqual({ source: 'Kudos', target: '点赞' });
  });

  test.each([
    ['archiveofourown.org', 'AO3(简体中文)'],
    ['codeforces.com', '计算机(简体中文)'],
    ['www.bloomberg.com', '金融(简体中文)'],
    ['www.allrecipes.com', '餐饮(简体中文)'],
    ['www.justia.com', '法律(简体中文)'],
    ['www.mayoclinic.org', '医学(简体中文)'],
    ['www.imdb.com', '影视(简体中文)'],
    ['www.musictheory.net', '音乐(简体中文)'],
    ['www.reuters.com', '新闻(简体中文)'],
    ['www.dpreview.com', '摄影(简体中文)'],
    ['www.zdnet.com', '计算机(简体中文)'],
    ['ethereum.org', '计算机(简体中文)'],
  ])('%s 上的当前领域是 %s', (host, name) => {
    expect(currentDomain(domains, host, 'zh-CN')?.name).toBe(name);
  });

  test('访问控制的术语并入“计算机(简体中文)”，不单开领域', () => {
    const dev = byName('计算机(简体中文)');
    for (const [source, target] of [
      ['AccessControl', '访问控制'],
      ['Authorization', '授权'],
      ['Authentication', '认证'],
      ['ACP', '访问控制策略'],
      ['ACL', '访问控制列表'],
      ['RBAC', '基于角色的访问控制'],
      ['ABAC', '基于属性的访问控制'],
      ['ReBAC', '基于关系的访问控制'],
    ]) {
      expect(dev.terms).toContainEqual({ source, target });
    }
    expect(domains.some((d) => d.name === '访问控制(简体中文)')).toBe(false);
  });

  test('软件开发、编程语言、编程竞赛、技术术语、Web3、Web3 术语合并为“计算机(简体中文)”，已有的原词保留原译法', () => {
    const dev = byName('计算机(简体中文)');
    for (const term of [
      { source: 'Database', target: '数据库' },
      { source: 'Permission', target: '权限' },
      { source: 'repository', target: '仓库' },
      { source: 'release', target: '发行版' },
      { source: 'Query', target: '查询' },
      { source: 'hack', noTranslate: true },
      { source: 'Wrong Answer', target: '答案错误' },
      { source: 'upsolve', target: '补题' },
      { source: 'Machine Learning', target: '机器学习' },
      { source: 'Bitcoin', noTranslate: true },
      { source: 'Blockchain', target: '区块链' },
      { source: 'fork', noTranslate: true },
    ]) {
      expect(dev.terms).toContainEqual(term);
    }
    expect(dev.terms).not.toContainEqual({ source: 'Repository', target: '代码仓库' });
    expect(dev.terms).not.toContainEqual({ source: 'query', target: '询问' });
    expect(dev.terms).toHaveLength(52 + 40 + 85 + 22 + 8 + 57);
    expect(new Set(dev.terms.map((t) => t.source.toLowerCase())).size).toBe(dev.terms.length);
    expect(dev.id).toBe('builtin:software-zh-CN');
  });

  test.each([
    '博德之门 3',
    '绝地潜兵 2',
    'Shelter69 俚语',
    '鸣潮',
    'Vocaloid',
    '剑星服装',
    '背包船',
    '编程术语',
    '编程竞赛',
    '软件开发',
    '技术术语',
    '编程',
    'Web3 术语',
    '体育',
    '旅行',
    '生物',
    '汽车',
    '国际象棋',
    '电商',
    '教育',
    '时尚',
    '游戏术语',
    '园艺',
    '高尔夫',
    '宠物',
    '网球',
    'Twitter',
  ])('%s 不内置', (name) => {
    expect(domains.some((d) => d.name === `${name}(简体中文)`)).toBe(false);
  });

  test('每个领域都有预置站点；预置之外的站点不命中，仍可手选', () => {
    for (const d of termDomains) expect(d.sites.length, d.name).toBeGreaterThan(0);
    const legal = byName('法律(简体中文)');
    expect(currentDomain(domains, 'en.wikipedia.org', 'zh-CN')).toBeNull();
    expect(currentDomain(domains, 'example.com', 'zh-CN', { kind: 'domain', id: legal.id })?.id).toBe(legal.id);
  });

  test('适用网址都合法，也不命中别的内置领域', async () => {
    for (const d of termDomains) {
      await setDomainSites(d.id, d.sites);
      for (const site of d.sites) {
        const others = domains.filter((o) => o !== d && o.sites.some((e) => siteMatches(site, e)));
        expect(others.map((o) => o.name), `${d.name} 的 ${site}`).toEqual([]);
      }
    }
  });
});
