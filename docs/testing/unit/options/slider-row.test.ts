/**
 * 设置页的滑块行工厂（#967，父 #964）
 *
 * 悬浮球大小、逐段翻译按钮大小、按钮显示时长三个滑块共用这一个工厂：
 * 收标签、范围、步长、单位、读数格式、取值与写值，返回一行 DOM 与一个
 * sync()。拖动时读数与 onInput 立刻跟着走；写盘防抖 —— storage.sync 有
 * 写入频率配额，每个 input 事件写一次会被限流。
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSliderRow, SLIDER_SAVE_DELAY } from '~/entrypoints/options/slider-row';

function setup(initial = 44) {
  let stored = initial;
  const set = vi.fn((v: number) => {
    stored = v;
  });
  const onInput = vi.fn();
  const slider = createSliderRow({
    id: 'pt-slider-test',
    labelKey: 'noSuchKeyForTest',
    labelFallback: 'Ball size',
    min: 32,
    max: 72,
    step: 2,
    unit: 'px',
    format: (v) => String(v),
    get: () => stored,
    set,
    onInput,
  });
  document.body.appendChild(slider.row);
  const input = slider.row.querySelector('input[type="range"]') as HTMLInputElement;
  const readout = slider.row.querySelector('output') as HTMLOutputElement;
  const drag = (v: number) => {
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  return { slider, input, readout, set, onInput, drag, setStored: (v: number) => (stored = v) };
}

describe('createSliderRow（#967）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('建出来的滑块带范围、步长、当前值，读数带单位；标签经 for 关联到滑块，读屏能读到名字与带单位的值', () => {
    const { input, readout, slider } = setup(44);
    expect(input.min).toBe('32');
    expect(input.max).toBe('72');
    expect(input.step).toBe('2');
    expect(input.value).toBe('44');
    expect(readout.textContent).toBe('44 px');
    const label = slider.row.querySelector('label')!;
    expect(label.htmlFor).toBe(input.id);
    // 测试环境的 getMessage 原样返回 key：标签文字走 i18n
    expect(label.textContent).toBe('noSuchKeyForTest');
    expect(input.getAttribute('aria-valuetext')).toBe('44 px');
  });

  test('拖动时读数与 onInput 立刻跟着变，写盘等停手之后只写一次', () => {
    const { drag, readout, set, onInput, input } = setup(44);
    drag(50);
    drag(56);
    drag(60);
    expect(readout.textContent).toBe('60 px');
    expect(input.getAttribute('aria-valuetext')).toBe('60 px');
    expect(onInput).toHaveBeenLastCalledWith(60);
    expect(set).not.toHaveBeenCalled();

    vi.advanceTimersByTime(SLIDER_SAVE_DELAY - 1);
    expect(set).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(60);
  });

  test('鼠标松手立即写盘，不再等防抖，也不重复写', () => {
    const { drag, input, set } = setup(44);
    drag(52);
    input.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(52);
    vi.advanceTimersByTime(SLIDER_SAVE_DELAY * 2);
    expect(set).toHaveBeenCalledTimes(1);
  });

  test('键盘按住方向键：每一步都派发 input 与 change，写盘仍只在停手后写一次（storage.sync 配额）', () => {
    const { input, set, readout } = setup(44);
    for (let v = 46; v <= 72; v += 2) {
      input.value = String(v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      vi.advanceTimersByTime(30); // 按键自动重复的间隔
    }
    expect(readout.textContent).toBe('72 px');
    expect(set).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SLIDER_SAVE_DELAY);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(72);
  });

  test('防抖没到点就关掉设置页：pagehide 时补写最后的值', () => {
    const { drag, set } = setup(44);
    drag(64);
    window.dispatchEvent(new Event('pagehide'));
    expect(set).toHaveBeenCalledWith(64);
  });

  test('sync() 按存储值重画滑块与读数（别处改了设置）', () => {
    const { slider, setStored, input, readout } = setup(44);
    setStored(64);
    slider.sync();
    expect(input.value).toBe('64');
    expect(readout.textContent).toBe('64 px');
  });

  test('还有没写盘的拖动时 sync() 不把滑块拽回旧值', () => {
    const { slider, drag, input, readout } = setup(44);
    drag(60);
    // 期间别的设置变了，回调里 sync() —— 存储里的尺寸还是 44
    slider.sync();
    expect(input.value).toBe('60');
    expect(readout.textContent).toBe('60 px');
  });

  test('读数格式由调用方给出（显示时长按秒显示）', () => {
    const s = createSliderRow({
      id: 'pt-slider-delay',
      labelKey: 'noSuchKeyForTest',
      labelFallback: 'Delay',
      min: 500,
      max: 3000,
      step: 100,
      unit: 's',
      format: (v) => (v / 1000).toFixed(1),
      get: () => 1500,
      set: () => {},
    });
    expect(s.row.querySelector('output')!.textContent).toBe('1.5 s');
  });
});
