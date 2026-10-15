/**
 * CONTEXT.md 术语映射表里的悬浮 UI 尺寸条目（#990）
 *
 * 词表写到“找得到”为止。这里钉两件事：floatingUiVars 读的每个设置项都在表里
 * 有名字（下一个加尺寸设置项的人漏登记会红）；表里点名的尺寸链路入口在代码里
 * 确实存在（改名后词表跟着改）。
 */
import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DEFAULT_SETTINGS } from '~/src/storage/schema';

const read = (p: string) => fs.readFileSync(path.resolve(p), 'utf8');
const context = read('CONTEXT.md');
const glossary = context.slice(context.indexOf('## 术语映射'), context.indexOf('\n## ', context.indexOf('## 术语映射') + 1));
/** 表里某个用户语言那一行 */
const rowOf = (term: string) => glossary.split('\n').find((l) => l.startsWith(`| **${term}** |`)) ?? '';

describe('术语映射表：悬浮 UI 尺寸（#990）', () => {
  test('floatingUiVars 读的每个设置项都在“悬浮 UI 尺寸”那一行里', () => {
    const src = read('src/ui/floating-ui-size.ts');
    const keys = Object.keys(DEFAULT_SETTINGS).filter((k) => src.includes(`s.${k}`));
    expect(keys.length).toBeGreaterThanOrEqual(3);
    const row = rowOf('悬浮 UI 尺寸');
    for (const k of keys) expect(row, k).toContain(`\`${k}\``);
  });

  test('查“悬浮球”“逐段翻译”能找到各自的尺寸与时长设置项', () => {
    expect(rowOf('悬浮球')).toContain('`floatingBallSize`');
    expect(rowOf('逐段翻译')).toContain('`paraBtnSize`');
    expect(rowOf('逐段翻译')).toContain('`paraBtnHideDelay`');
  });

  test('表里点名的尺寸链路入口在代码里确实存在', () => {
    const where: Record<string, string> = {
      'floatingUiVars()': 'src/ui/floating-ui-size.ts',
      'clampWriteEntry()': 'src/storage/settings.ts',
      'applySettings()': 'entrypoints/content.ts',
      'createSliderRow()': 'entrypoints/options/slider-row.ts',
      'createFloatingPreview()': 'entrypoints/options/floating-preview.ts',
      'createBall()': 'src/ui/floating-ball.ts',
    };
    const row = rowOf('悬浮 UI 尺寸') + rowOf('悬浮球');
    for (const [name, file] of Object.entries(where)) {
      expect(row, name).toContain(`\`${name}\``);
      expect(read(file), `${name} 在 ${file}`).toMatch(new RegExp(`function ${name.slice(0, -2)}\\(`));
    }
  });
});
