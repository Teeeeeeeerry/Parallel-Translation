/**
 * storage/specialization.ts — 领域与规则存储模块：生效站点规则（#366、#367）
 *
 * 本期只有内置来源；按当前站点读取，网址匹配沿用站点黑白名单的
 * 裸域名语义（子域归入、主域名归一）。
 */
import { describe, test, expect } from 'vitest';
import { getSiteRules } from '~/src/storage/specialization';

describe('getSiteRules（生效站点规则）', () => {
  test('youtube.com 返回迁自 compat 的内置排除', () => {
    expect(getSiteRules('www.youtube.com').exclude).toEqual([
      '.ytd-thumbnail-overlay-time-status-renderer',
      '#metadata-line span',
      '.ytd-video-meta-block ytd-badge-supported-renderer',
      '.ytd-channel-name yt-formatted-string',
    ]);
  });

  test('github.com 返回迁自 compat 的内置排除（#367）', () => {
    expect(getSiteRules('github.com').exclude).toEqual([
      '.blob-code',
      '.blob-code-inner',
      '.file-info',
      '.file-header',
      '.commit-tease-sha',
      '.commit-message code',
      '.highlight',
      '.blame-hunk',
      '.text-mono',
      '.file-tree',
      '.js-file-tree',
      '.tree-browser',
      '.BorderGrid',
      '.repository-lang-stats',
    ]);
  });

  test('子域归入：m.youtube.com 与 youtube.com 同一份规则', () => {
    expect(getSiteRules('m.youtube.com')).toEqual(getSiteRules('youtube.com'));
  });

  test('没有内置规则的站点返回空规则', () => {
    expect(getSiteRules('example.com')).toEqual({ exclude: [] });
  });

  test('仅后缀相同的域名不误命中', () => {
    expect(getSiteRules('notyoutube.com')).toEqual({ exclude: [] });
  });
});
