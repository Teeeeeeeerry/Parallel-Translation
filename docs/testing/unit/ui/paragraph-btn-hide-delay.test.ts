/**
 * 逐段翻译按钮的显示时长（#972，父 #964）
 *
 * 鼠标离开段落后按钮停留多久，由内容脚本经 handlers 传入的取值函数决定，
 * 每次开始倒计时都重新问一次 —— 不是构造时读一次的快照。改了设置不用重建
 * 按钮，下一次离开段落就按新值计时。src/ui 下不读 getSettings，这条约定
 * 由取值函数守住。
 *
 * 只看外部可观察的行为：按钮过了多久还在不在。假定时器推进时间。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createParaBtn } from '~/src/ui/paragraph-btn';

function button(): HTMLElement {
  return document.getElementById('pt-host-para-btn')!.shadowRoot!.querySelector('.pt-para-btn')!;
}

/** 按钮浮在某段上：浮出由悬停意图与段落精判决定（jsdom 不排版），这里直接摆成显示态 */
function showButton(): void {
  button().style.display = 'block';
}

/** 鼠标从段落移到页面别处：document 上的 mouseout 开始倒计时 */
function leaveParagraph(): void {
  document.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
}

const visible = () => button().style.display === 'block';

describe('逐段翻译按钮的显示时长取值函数（#972）', () => {
  let stop: () => void;
  let delay: number;
  let reads: number;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<p>Some paragraph text.</p>';
    delay = 1500;
    reads = 0;
    stop = createParaBtn({
      translate: async () => {},
      restore: () => {},
      hideDelay: () => {
        reads++;
        return delay;
      },
    });
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  test('离开段落后按取值函数的值计时：默认 1.5 秒', () => {
    showButton();
    leaveParagraph();
    vi.advanceTimersByTime(1499);
    expect(visible()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(visible()).toBe(false);
  });

  test('建好按钮后改了取值函数的返回值，下一次离开段落就按新值计时，不用重建按钮', () => {
    showButton();
    leaveParagraph();
    vi.advanceTimersByTime(1500);
    expect(visible()).toBe(false);

    delay = 600;
    showButton();
    leaveParagraph();
    vi.advanceTimersByTime(599);
    expect(visible()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(visible()).toBe(false);

    delay = 3000;
    showButton();
    leaveParagraph();
    vi.advanceTimersByTime(2999);
    expect(visible()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(visible()).toBe(false);
  });

  test('每次开始倒计时都重新问取值函数，构造时不读', () => {
    expect(reads).toBe(0);
    showButton();
    leaveParagraph();
    leaveParagraph();
    expect(reads).toBe(2);
  });

  test('鼠标从按钮上移开同样按取值函数的值计时', () => {
    delay = 800;
    showButton();
    button().dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    vi.advanceTimersByTime(799);
    expect(visible()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(visible()).toBe(false);
  });
});

describe('src/ui 不读设置存储（#972 守住的约定）', () => {
  test('src/ui 下没有任何模块导入 storage/settings：设置一律由内容脚本注入回调或取值函数', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const dir = path.resolve('src/ui');
    const offenders = fs
      .readdirSync(dir, { recursive: true, encoding: 'utf-8' })
      .filter((f) => /\.ts$/.test(f))
      .filter((f) => /from\s+['"][^'"]*storage\/settings['"]/.test(fs.readFileSync(path.join(dir, f), 'utf-8')));
    expect(offenders).toEqual([]);
  });
});
