/**
 * 拒收术语带行号与原因（#1150）
 *
 * setDomainTerms 拒收时，InvalidTermsError.rows 按提交的术语数组的序号列出每一
 * 行的问题。设置页的领域分区只按这里的行号标红，不再自己重算一遍校验口径
 * （去空白、勾了“不翻译”就不看译法、不区分大小写判重）。
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { resetStorage } from '~/docs/testing/setup';
import { createDomain, InvalidTermsError, setDomainTerms } from '~/src/storage/domains';

beforeEach(() => {
  resetStorage();
});

async function rejection(terms: Parameters<typeof setDomainTerms>[1]): Promise<InvalidTermsError> {
  const d = await createDomain({ name: '测试', targetLang: 'zh-CN' });
  const e = await setDomainTerms(d.id, terms).catch((err: unknown) => err);
  expect(e).toBeInstanceOf(InvalidTermsError);
  return e as InvalidTermsError;
}

describe('InvalidTermsError.rows（#1150）', () => {
  test('重复原词（不区分大小写、去首尾空白）的每一处都列出，含第一次出现的那行', async () => {
    const e = await rejection([
      { source: 'API', target: '接口' },
      { source: 'ok', target: '好' },
      { source: ' api ', target: '应用程序接口' },
      { source: 'Api', noTranslate: true },
    ]);
    expect(e.rows).toEqual([
      { index: 0, reason: 'duplicate' },
      { index: 2, reason: 'duplicate' },
      { index: 3, reason: 'duplicate' },
    ]);
    expect(e.duplicates).toEqual(['api']);
  });

  test('缺译法、缺原词；勾了“不翻译”的行不看译法；两项都空的行忽略', async () => {
    const e = await rejection([
      { source: 'no-target', target: '  ' },
      { source: '', target: '只有译法' },
      { source: 'skip-flag', target: '', noTranslate: true },
      { source: '', target: '' },
      { source: 'dup', target: 'a' },
      { source: 'DUP', target: '' },
    ]);
    expect(e.rows).toEqual([
      { index: 0, reason: 'missingTarget' },
      { index: 1, reason: 'missingSource' },
      { index: 4, reason: 'duplicate' },
      { index: 5, reason: 'duplicate' },
      { index: 5, reason: 'missingTarget' },
    ]);
  });
});
