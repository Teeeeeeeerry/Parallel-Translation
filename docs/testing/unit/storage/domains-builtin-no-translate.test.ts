/**
 * 只含“不翻译”术语的内置领域 单元测试
 *
 * 通用、游戏、编程语言、科技公司与 AI、Web3 五个内置领域出现在生效领域
 * 列表里，各自在预置的网址上成为当前领域；编程语言的术语也并入
 * “软件开发(简体中文)”，代码托管站点上照样不翻译。
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { getEffectiveDomains, currentDomain, type Domain } from '~/src/storage/domains';
import { siteMatches } from '~/src/dom/site-filter';
import { resetStorage } from '~/docs/testing/setup';

const NO_TRANSLATE_DOMAINS: Record<string, string[]> = {
  '通用(简体中文)': ['LLM', 'LLMs'],
  '游戏(简体中文)': ['Steam', 'Epic Games', 'PlayStation', 'Xbox', 'Switch'],
  '编程语言(简体中文)': [
    'Python', 'JavaScript', 'TypeScript', 'Java', 'Rust', 'Swift', 'Kotlin', 'Ruby',
    'PHP', 'MATLAB', 'SQL', 'HTML', 'CSS', 'Shell', 'stub',
  ],
  '科技公司与 AI(简体中文)': [
    'GPT', 'Claude', 'Gemini', 'LLaMA', 'Mistral', 'OpenAI', 'Anthropic', 'Google', 'DeepMind',
    'Meta', 'Microsoft', 'Amazon', 'Apple', 'NVIDIA', 'Intel', 'AMD', 'IBM', 'Oracle',
    'Salesforce', 'Adobe', 'Autodesk',
  ],
  'Web3(简体中文)': [
    'Bitcoin', 'Ethereum', 'Solana', 'Cardano', 'Polygon', 'Avalanche', 'Binance Smart Chain', 'Web3',
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
  test.each(Object.entries(NO_TRANSLATE_DOMAINS))('%s：内置、简体中文、术语全部不翻译', (name, sources) => {
    const d = byName(name);
    expect(d.origin).toBe('builtin');
    expect(d.targetLang).toBe('zh-CN');
    expect(d.terms).toEqual(sources.map((source) => ({ source, noTranslate: true })));
  });

  test('排在“软件开发(简体中文)”之后', () => {
    expect(domains.filter((d) => d.origin === 'builtin').map((d) => d.name)).toEqual([
      '软件开发(简体中文)',
      ...Object.keys(NO_TRANSLATE_DOMAINS),
    ]);
  });

  test.each([
    ['huggingface.co', '通用(简体中文)'],
    ['store.steampowered.com', '游戏(简体中文)'],
    ['www.xbox.com', '游戏(简体中文)'],
    ['developer.mozilla.org', '编程语言(简体中文)'],
    ['docs.python.org', '编程语言(简体中文)'],
    ['techcrunch.com', '科技公司与 AI(简体中文)'],
    ['www.theverge.com', '科技公司与 AI(简体中文)'],
    ['coinmarketcap.com', 'Web3(简体中文)'],
    ['etherscan.io', 'Web3(简体中文)'],
  ])('%s 上的当前领域是 %s', (host, name) => {
    expect(currentDomain(domains, host, 'zh-CN')?.name).toBe(name);
  });

  test('编程语言的词并入“软件开发(简体中文)”，github.com 上仍是它', () => {
    const dev = byName('软件开发(简体中文)');
    for (const source of NO_TRANSLATE_DOMAINS['编程语言(简体中文)']!) {
      expect(dev.terms).toContainEqual({ source, noTranslate: true });
    }
    expect(currentDomain(domains, 'github.com', 'zh-CN')?.id).toBe(dev.id);
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
