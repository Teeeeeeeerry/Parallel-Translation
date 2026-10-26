/**
 * src/dom 模块之间没有循环 import（#1145）
 *
 * 判定的标签表与谓词（classify）、取文（text）、切分（chunk-split、br-split、
 * pre-split）原先互相 import，靠“只在函数体里用”躲开初始化顺序问题。#1145
 * 把“找最近单元”搬进翻译单元模块（units.ts）之后依赖是单向的；这里读源码
 * 里的相对 import，确认整个 src/dom 的依赖图没有环。
 */
import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const DIR = 'src/dom';

function graph(): Map<string, string[]> {
  const g = new Map<string, string[]>();
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(DIR, file), 'utf-8');
    const deps = new Set<string>();
    // import / export … from，含 import type（类型导入同样算依赖方向）
    for (const m of src.matchAll(/^(?:import|export)\b[^;]*?from '(\.\/[^']+|~\/src\/dom\/[^']+)';/gms)) {
      deps.add(path.basename(m[1]!) + '.ts');
    }
    g.set(file, [...deps]);
  }
  return g;
}

function findCycle(g: Map<string, string[]>): string[] | null {
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const visit = (n: string): string[] | null => {
    if (state.get(n) === 'done') return null;
    if (state.get(n) === 'visiting') return [...stack.slice(stack.indexOf(n)), n];
    state.set(n, 'visiting');
    stack.push(n);
    for (const d of g.get(n) ?? []) {
      const c = visit(d);
      if (c) return c;
    }
    stack.pop();
    state.set(n, 'done');
    return null;
  };
  for (const n of g.keys()) {
    const c = visit(n);
    if (c) return c;
  }
  return null;
}

describe('src/dom 的 import 依赖图（#1145）', () => {
  test('读到了判定、取文、切分与翻译单元模块', () => {
    const g = graph();
    for (const f of ['classify.ts', 'text.ts', 'chunk-split.ts', 'br-split.ts', 'pre-split.ts', 'units.ts']) {
      expect(g.has(f)).toBe(true);
    }
    expect(g.get('units.ts')).toEqual(expect.arrayContaining(['classify.ts', 'text.ts', 'br-split.ts']));
  });

  test('没有环', () => {
    expect(findCycle(graph())).toBeNull();
  });
});
