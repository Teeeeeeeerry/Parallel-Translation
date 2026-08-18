/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "https://www.youtube.com/watch?v=test"}
 */
/**
 * dom/compat.ts — youtube.com 域名补丁测试（#114）
 *
 * 此前 YouTube 处理器（skip 分支）零覆盖。jsdom 的 location.hostname
 * 是文件级选项，与 localhost / github.com 的测试文件分离。
 */
import { describe, test, expect } from 'vitest';
import { applyCompat, mainDomain } from '~/src/dom/compat';

function el(html: string): Element {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstElementChild!;
}

describe('mainDomain', () => {
  test('www.youtube.com → youtube.com', () => {
    expect(mainDomain('www.youtube.com')).toBe('youtube.com');
  });
});

describe('applyCompat（youtube.com）', () => {
  test('时长角标 → skip', () => {
    const badge = el(
      '<ytd-thumbnail-overlay-time-status-renderer class="ytd-thumbnail-overlay-time-status-renderer">12:34</ytd-thumbnail-overlay-time-status-renderer>',
    );
    expect(applyCompat(badge)).toEqual({ skip: true });
  });

  test('#metadata-line span（播放量/发布时间）→ skip', () => {
    const inner = el('<div id="metadata-line"><span>1.2M views</span></div>').querySelector('span')!;
    expect(applyCompat(inner)).toEqual({ skip: true });
  });

  test('.ytd-video-meta-block ytd-badge-supported-renderer → skip', () => {
    const badge = el(
      '<div class="ytd-video-meta-block"><ytd-badge-supported-renderer>CC</ytd-badge-supported-renderer></div>',
    ).querySelector('ytd-badge-supported-renderer')!;
    expect(applyCompat(badge)).toEqual({ skip: true });
  });

  test('.ytd-channel-name yt-formatted-string（频道名）→ skip', () => {
    const name = el(
      '<div class="ytd-channel-name"><yt-formatted-string>Channel Name</yt-formatted-string></div>',
    ).querySelector('yt-formatted-string')!;
    expect(applyCompat(name)).toEqual({ skip: true });
  });

  test('普通正文元素 → null（交回通用逻辑）', () => {
    const p = el('<p>This video explains the basics.</p>');
    expect(applyCompat(p)).toBeNull();
  });
});
