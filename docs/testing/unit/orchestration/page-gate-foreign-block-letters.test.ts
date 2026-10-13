/**
 * orchestration/page-gate.ts — 外文块要求单元里字母占多数（#901，父 #898）
 *
 * #890 实测：若依文档首页最长的单元是一串 448 字符的 QQ 群号，识别器报可靠的
 * ht（海地克里奥尔语），于是算成外文块，整页被放行（#892 重算两遍都如此）。
 * 一串数字不是外文正文：单元里字母（Unicode 字母属性）要占多数才算外文块。
 *
 * 单元的字数与字母数都由 longestUnitTexts 从真实文字算出，再连同替身给定的
 * 识别结果交给纯判定函数；不调真实识别器。
 */
import { describe, test, expect } from 'vitest';
import {
  decidePageGate,
  longestUnitTexts,
  type ContentLang,
  type UnitLang,
} from '~/src/orchestration/page-gate';

const reliable = (...languages: [string, number][]): ContentLang => ({
  reliable: true,
  languages: languages.map(([lang, percentage]) => ({ lang, percentage })),
});

/** 一段真实文字作为单元，识别结果由替身给定（可靠）。 */
function unitOf(text: string, lang: string): UnitLang {
  const [picked] = longestUnitTexts([text]);
  if (!picked) throw new Error('单元不到外文块下限，用例写错了');
  return { chars: picked.chars, letters: picked.letters, lang, reliable: true };
}

/** 中文页面，全页样本中文占优、可靠：没有外文块就拦下。 */
const zhPage = (units: UnitLang[]) =>
  decidePageGate({
    to: 'zh-CN',
    detectedLang: null,
    pageLang: 'en-US',
    contentLang: reliable(['zh', 90], ['en', 5]),
    contentUnits: units,
  });

const BLOCK_ZH = { translate: false, reason: 'same-language', lang: 'zh-CN' };
const FOREIGN = { translate: true, basis: 'foreign-block' };

// 若依文档首页的 QQ 群号那一段（#890），照原样的形状拼到 448 字符
const QQ_GROUPS = Array.from(
  { length: 40 },
  (_, i) => `${1389287 + i * 290007}（${i + 1}群）`,
)
  .join(' 、 ')
  .slice(0, 448);

const ENGLISH =
  'Lethal Company is a cooperative horror game about scavenging at abandoned moons to sell scrap to the Company. ' +
  'You are a contracted worker for the Company. Your job is to collect scrap from abandoned, industrialized moons ' +
  'to meet the profit quota. You can use the cash you earn to travel to new moons with higher risks and rewards.';

describe('外文块要求单元里字母占多数', () => {
  test('一串数字（QQ 群号）被识别成可靠的外文：不算外文块，拦下', () => {
    expect(QQ_GROUPS.length).toBe(448);
    expect(zhPage([unitOf(QQ_GROUPS, 'ht')])).toMatchObject(BLOCK_ZH);
  });

  test('纯数字、标点、符号串都不算外文块', () => {
    const digits = '1234567890 '.repeat(30);
    const punct = '-- ... ,, ;; !! ?? '.repeat(20);
    const symbols = '+ = < > | ~ $ % ^ & * # @ '.repeat(15);
    for (const text of [digits, punct, symbols]) {
      expect(zhPage([unitOf(text, 'en')])).toMatchObject(BLOCK_ZH);
    }
  });

  test('真的英文正文照常算外文块', () => {
    expect(ENGLISH.length).toBeGreaterThan(245);
    expect(zhPage([unitOf(ENGLISH, 'en')])).toMatchObject(FOREIGN);
  });

  test('中英混排、带版本号与网址，字母仍占多数：照常算外文块', () => {
    const mixed =
      'RuoYi v4.8.1 是一个 Java EE 企业级快速开发平台 based on Spring Boot 2.5.15, Apache Shiro 1.13.0, ' +
      'MyBatis 3.5.16, Thymeleaf and Bootstrap 3.3.7. See https://gitee.com/y_project/RuoYi for the source, ' +
      'and https://doc.ruoyi.vip for the documentation. Built-in modules: user management, role management, ' +
      'menu management, department management, dictionary management, operation log, login log.';
    expect(mixed.length).toBeGreaterThan(245);
    expect(zhPage([unitOf(mixed, 'en')])).toMatchObject(FOREIGN);
  });

  test('“占多数”是字母数超过全文字符数的一半：恰好一半不算，过半就算', () => {
    const half = 'ab12'.repeat(70);
    const over = 'abc12'.repeat(56);
    expect(zhPage([unitOf(half, 'en')])).toMatchObject(BLOCK_ZH);
    expect(zhPage([unitOf(over, 'en')])).toMatchObject(FOREIGN);
  });

  test('一串数字排在最前，后面另有一块真的外文正文：照常翻译', () => {
    expect(zhPage([unitOf(QQ_GROUPS, 'ht'), unitOf(ENGLISH, 'en')])).toMatchObject(FOREIGN);
  });
});

describe('字母数的口径（Unicode 字母属性）', () => {
  test('数字、标点、符号与空白都不算字母', () => {
    const [u] = longestUnitTexts(['1 2 3 , . ; + = '.repeat(20) + 'abc']);
    expect(u!.letters).toBe(3);
  });

  test('任何文字的字母都算：拉丁、西里尔、汉字、假名、谚文', () => {
    const text = 'abcабв汉字かなカナ한글'.repeat(20);
    const [u] = longestUnitTexts([text]);
    expect(u!.letters).toBe(text.length);
  });

  test('附在字母上的组合记号算作字母（天城文、泰文的元音符号）', () => {
    const text = 'नमस्ते दुनिया สวัสดีชาวโลก '.repeat(12);
    const [u] = longestUnitTexts([text]);
    expect(u!.letters).toBe(text.replace(/\s/gu, '').length);
  });
});
