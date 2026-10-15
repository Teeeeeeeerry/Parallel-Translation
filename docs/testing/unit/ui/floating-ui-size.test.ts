/**
 * 悬浮 UI 尺寸：设置 → CSS 自定义属性的纯函数（#966，父 #964）
 *
 * 这是 #964 的主测试缝：给设置、断言变量键值，不碰 DOM、不读存储。
 * 内容脚本把结果写到文档根上，设置页的预览读同一份输出（#968），
 * 所以尺寸换算只有这一处。
 */
import { describe, test, expect } from 'vitest';
import { floatingUiVars } from '~/src/ui/floating-ui-size';
import { DEFAULT_SETTINGS, BALL_SIZE_MIN, BALL_SIZE_MAX } from '~/src/storage/schema';

describe('floatingUiVars（#966）', () => {
  test('默认设置得到与原来硬编码相同的球尺寸', () => {
    expect(floatingUiVars(DEFAULT_SETTINGS)['--pt-ball-size']).toBe('44px');
  });

  test('调大、调小各得到对应的值', () => {
    expect(floatingUiVars({ ...DEFAULT_SETTINGS, floatingBallSize: 60 })['--pt-ball-size']).toBe('60px');
    expect(floatingUiVars({ ...DEFAULT_SETTINGS, floatingBallSize: 36 })['--pt-ball-size']).toBe('36px');
  });

  test('存储里绕过写入口的脏值也出合法尺寸，不出 NaNpx 这种让球塌掉的值', () => {
    for (const bad of [Number.NaN, 'big', null, undefined]) {
      expect(floatingUiVars({ ...DEFAULT_SETTINGS, floatingBallSize: bad as never })['--pt-ball-size']).toBe('44px');
    }
    expect(floatingUiVars({ ...DEFAULT_SETTINGS, floatingBallSize: 9999 })['--pt-ball-size']).toBe(`${BALL_SIZE_MAX}px`);
    expect(floatingUiVars({ ...DEFAULT_SETTINGS, floatingBallSize: 1 })['--pt-ball-size']).toBe(`${BALL_SIZE_MIN}px`);
  });
});
