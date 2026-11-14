/**
 * 以“不翻译”术语为主的内置领域 单元测试
 *
 * 通用、科技公司与 AI 两个内置领域出现在生效领域列表里，各自在预置的网址上
 * 成为当前领域；编程语言名与公链名并入“计算机(简体中文)”，代码托管、语言官网
 * 与加密货币站点上都不翻译。游戏领域已删除。
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { getEffectiveDomains, currentDomain, type Domain } from '~/src/storage/domains';
import { siteMatches } from '~/src/dom/site-filter';
import { resetStorage } from '~/docs/testing/setup';

const PROGRAMMING_LANGUAGES = [
  'Python', 'JavaScript', 'TypeScript', 'Java', 'Rust', 'Swift', 'Kotlin', 'Ruby',
  'PHP', 'MATLAB', 'SQL', 'HTML', 'CSS', 'Shell', 'stub',
];

const CHAINS = ['Bitcoin', 'Ethereum', 'Solana', 'Cardano', 'Polygon', 'Avalanche', 'Binance Smart Chain', 'Web3'];

const NO_TRANSLATE_DOMAINS: Record<string, string[]> = {
  '通用(简体中文)': ['LLM', 'LLMs'],
  '科技公司与 AI(简体中文)': [
    'GPT', 'Claude', 'Gemini', 'LLaMA', 'Mistral', 'OpenAI', 'Anthropic', 'Google', 'DeepMind',
    'Meta', 'Microsoft', 'Amazon', 'Apple', 'NVIDIA', 'Intel', 'AMD', 'IBM', 'Oracle',
    'Salesforce', 'Adobe', 'Autodesk',
  ],
};

let domains: Domain[];

function byName(name: string): Domain {
  const d = domains.find((x) => x.name === name);
  expect(d, name).toBeDefined();
  return d!;
}

beforeEach(async () => {
  resetStorage();
  domains = await getEffectiveDomains();
});

describe('只含“不翻译”术语的内置领域', () => {
  test.each(Object.entries(NO_TRANSLATE_DOMAINS))('%s：内置、简体中文，“不翻译”术语与原表一致', (name, sources) => {
    const d = byName(name);
    expect(d.origin).toBe('builtin');
    expect(d.targetLang).toBe('zh-CN');
    expect(d.terms.filter((t) => t.noTranslate)).toEqual(sources.map((source) => ({ source, noTranslate: true })));
  });

  test('排在“计算机(简体中文)”之后', () => {
    expect(domains.slice(0, 3).map((d) => d.name)).toEqual([
      '计算机(简体中文)',
      ...Object.keys(NO_TRANSLATE_DOMAINS),
    ]);
  });

  test.each([
    ['huggingface.co', '通用(简体中文)'],
    ['developer.mozilla.org', '计算机(简体中文)'],
    ['docs.python.org', '计算机(简体中文)'],
    ['techcrunch.com', '科技公司与 AI(简体中文)'],
    ['www.theverge.com', '科技公司与 AI(简体中文)'],
    ['coinmarketcap.com', '计算机(简体中文)'],
    ['etherscan.io', '计算机(简体中文)'],
  ])('%s 上的当前领域是 %s', (host, name) => {
    expect(currentDomain(domains, host, 'zh-CN')?.name).toBe(name);
  });

  test('编程语言名与公链名并入“计算机(简体中文)”，github.com 上仍是它', () => {
    const dev = byName('计算机(简体中文)');
    for (const source of [...PROGRAMMING_LANGUAGES, ...CHAINS]) {
      expect(dev.terms).toContainEqual({ source, noTranslate: true });
    }
    expect(currentDomain(domains, 'github.com', 'zh-CN')?.id).toBe(dev.id);
  });

  test.each(['游戏(简体中文)', '编程语言(简体中文)', 'Web3(简体中文)'])('%s 不内置', (name) => {
    expect(domains.some((d) => d.name === name)).toBe(false);
  });

  test('游戏站点不再命中内置领域', () => {
    expect(currentDomain(domains, 'store.steampowered.com', 'zh-CN')).toBeNull();
  });

  test('各内置领域的适用网址互不命中（按站点名单的主域名归一语义）', () => {
    const builtin = domains.filter((d) => d.origin === 'builtin');
    for (const d of builtin) {
      for (const site of d.sites) {
        const others = builtin.filter((o) => o !== d && o.sites.some((e) => siteMatches(site, e)));
        expect(others.map((o) => o.name), `${d.name} 的 ${site}`).toEqual([]);
      }
    }
  });
});
