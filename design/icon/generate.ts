/**
 * 从 src/ui/logo.ts 的字形定义渲染扩展图标。
 *
 * 产出 public/icon/{16,32,48,128}.png 与 design/icon/icon-{128,mark}.svg。
 * 字形只在 src/ui/logo.ts 里定义一次，popup、悬浮球与这里共用同一份 ——
 * 图标和界面里的标识因此不会各自漂移。
 *
 * 用法: pnpm icon:build   （等价于 npx tsx design/icon/generate.ts）
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { logoIconSvg, logoMarkSvg } from '../../src/ui/logo';

const HERE = dirname(fileURLToPath(import.meta.url));
const ICON_OUT = resolve(HERE, '../../public/icon');
const SVG_OUT = HERE;

/** manifest 声明的四个尺寸（见 wxt.config.ts 的 icons 字段）。 */
const SIZES = [16, 32, 48, 128] as const;

async function main(): Promise<void> {
  mkdirSync(ICON_OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    for (const size of SIZES) {
      const page = await browser.newPage({
        viewport: { width: size, height: size },
        // 按 1 渲染：图标要的是这个尺寸下的精确像素，不是缩放过的高清图
        deviceScaleFactor: 1,
      });
      const svg = logoIconSvg(size);
      await page.setContent(
        `<!doctype html><meta charset="utf-8">` +
          `<style>*{margin:0;padding:0}html,body{background:transparent}` +
          `svg{display:block}</style>${svg}`,
        { waitUntil: 'load' },
      );
      const file = join(ICON_OUT, `${size}.png`);
      // omitBackground 保住圆角外的透明像素，否则四角会是白的
      await page.screenshot({ path: file, omitBackground: true });
      await page.close();
      console.log(`  ${file}`);
    }
  } finally {
    await browser.close();
  }

  // 矢量源一并落盘，便于在商店素材或外部场合直接引用
  writeFileSync(join(SVG_OUT, 'icon-128.svg'), logoIconSvg(128) + '\n');
  writeFileSync(join(SVG_OUT, 'icon-mark.svg'), logoMarkSvg(128) + '\n');
  console.log(`  ${join(SVG_OUT, 'icon-128.svg')}`);
  console.log(`  ${join(SVG_OUT, 'icon-mark.svg')}`);
}

main().catch((e) => {
  console.error(`图标生成失败: ${e.message}`);
  process.exit(1);
});
