/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "https://www.youtube.com/watch?v=test"}
 */
/**
 * dom/walker.ts × 站点页面规则 —— youtube.com 的内置排除（#366）
 *
 * youtube.com 的 skip 补丁原先写在 compat.ts 代码层，#366 迁为内置
 * 排除数据（ADR-0003）。本文件在 walker 采集入口验证：
 *   - 迁移前后采集到的单元一致（典型观看页片段）
 *   - 原 compat-youtube.test.ts 的四个选择器都不采集
 *   - 排除是整块语义：命中元素的后代也不采集，根落在排除区内同样不采集
 *
 * 与旧补丁的有意差异：旧 skip 只跳过命中元素自身、继续遍历子树；排除
 * 按“整块不翻译”跳过整棵子树。四个选择器中有三个命中的是行内或自定义
 * 元素，本身当不成翻译单元，用例在其中放了块级后代才能观察到排除 ——
 * 这些后代在旧补丁下会被采集，属于整块语义带来的新行为。典型页面结构
 * 下两者一致，由第一个用例保证。
 *
 * jsdom 的 location.hostname 是文件级选项，与其他域名的测试文件分离。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mockAllBoundingRects } from '../../setup';
import { collect } from '~/src/dom/walker';

let restore: () => void;
beforeEach(() => {
  restore = mockAllBoundingRects();
});
afterEach(() => {
  restore();
  document.body.innerHTML = '';
});

const ids = (units: Element[]) => units.map((u) => u.id);

describe('collect（youtube.com 内置排除）', () => {
  test('典型观看页片段：迁移前后采集到的单元一致', () => {
    document.body.innerHTML = `
      <ytd-rich-item-renderer>
        <ytd-thumbnail>
          <ytd-thumbnail-overlay-time-status-renderer>
            <div id="time" class="style-scope ytd-thumbnail-overlay-time-status-renderer">UPCOMING</div>
          </ytd-thumbnail-overlay-time-status-renderer>
        </ytd-thumbnail>
        <div id="details">
          <h3 id="title"><a id="video-title">How transformers work, explained from scratch</a></h3>
          <div class="style-scope ytd-channel-name">
            <yt-formatted-string id="channel">Some Channel Name</yt-formatted-string>
          </div>
          <div id="metadata-line"><span>1.2M views</span><span>3 days ago</span></div>
          <div class="ytd-video-meta-block">
            <ytd-badge-supported-renderer><div class="badge"><span>New</span></div></ytd-badge-supported-renderer>
          </div>
        </div>
      </ytd-rich-item-renderer>
      <div id="description">
        <p id="desc">In this video we walk through attention step by step.</p>
      </div>`;
    // 基线取自迁移前（compat.ts 的 youtube.com skip 补丁）的采集结果。
    // 时长角标用 UPCOMING 而非 12:34：纯数字会先被通用判定过滤，测不到排除
    expect(ids(collect())).toEqual(['title', 'desc']);
  });

  test('时长角标（.ytd-thumbnail-overlay-time-status-renderer）不采集', () => {
    document.body.innerHTML =
      '<div id="badge" class="ytd-thumbnail-overlay-time-status-renderer">PREMIERE</div>' +
      '<p id="body">This video explains the basics.</p>';
    expect(ids(collect())).toEqual(['body']);
  });

  test('#metadata-line span（播放量/发布时间）不采集', () => {
    document.body.innerHTML =
      '<div id="metadata-line"><span><div id="views">Streamed live yesterday</div></span></div>' +
      '<p id="body">This video explains the basics.</p>';
    expect(ids(collect())).toEqual(['body']);
  });

  test('.ytd-video-meta-block ytd-badge-supported-renderer 不采集', () => {
    document.body.innerHTML =
      '<div class="ytd-video-meta-block"><ytd-badge-supported-renderer><div id="cc">Closed captions</div></ytd-badge-supported-renderer></div>' +
      '<p id="body">This video explains the basics.</p>';
    expect(ids(collect())).toEqual(['body']);
  });

  test('.ytd-channel-name yt-formatted-string（频道名）不采集', () => {
    document.body.innerHTML =
      '<div class="ytd-channel-name"><yt-formatted-string><div id="name">Channel Name</div></yt-formatted-string></div>' +
      '<p id="body">This video explains the basics.</p>';
    expect(ids(collect())).toEqual(['body']);
  });

  test('普通正文照常采集', () => {
    document.body.innerHTML = '<p id="body">This video explains the basics.</p>';
    expect(ids(collect())).toEqual(['body']);
  });

  test('排除整块生效：命中元素的后代单元也不采集', () => {
    document.body.innerHTML =
      '<div class="ytd-thumbnail-overlay-time-status-renderer"><p id="inner">Live now, streaming</p></div>' +
      '<p id="body">This video explains the basics.</p>';
    expect(ids(collect())).toEqual(['body']);
  });

  test('采集根落在排除区内（observer 增量补翻）时不采集', () => {
    document.body.innerHTML =
      '<div class="ytd-thumbnail-overlay-time-status-renderer"><p id="inner">Live now, streaming</p></div>';
    const inner = document.getElementById('inner')!;
    expect(collect(inner)).toEqual([]);
  });
});
