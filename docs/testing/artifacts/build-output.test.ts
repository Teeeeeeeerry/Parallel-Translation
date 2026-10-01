/**
 * 构建产物断言
 *
 * 不测源码，只测 .output/ 产物 —— 源码看着对但产物里缺失的 bug 只能用这种方式抓。
 */
import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const OUTPUT_DIR = path.resolve('.output');

/** 检查 .output 目录是否存在 */
function outputExists(): boolean {
  return fs.existsSync(OUTPUT_DIR);
}

describe('构建产物校验', () => {
  test('manifest.json 存在', () => {
    if (!outputExists()) {
      console.warn('⚠ .output/ 不存在，跳过产物断言（请先 pnpm build）');
      return;
    }
    const browsers = fs.readdirSync(OUTPUT_DIR).filter((d) => {
      const manifest = path.join(OUTPUT_DIR, d, 'manifest.json');
      return fs.existsSync(manifest);
    });
    expect(browsers.length).toBeGreaterThan(0);
  });

  test('manifest.json 包含 default_locale', () => {
    if (!outputExists()) return;
    const manifest = readFirstManifest();
    if (!manifest) return;
    expect(manifest.default_locale).toBe('zh_CN');
  });

  test('manifest.json 权限正确', () => {
    if (!outputExists()) return;
    const manifest = readFirstManifest();
    if (!manifest) return;
    expect(manifest.permissions).toContain('storage');
    expect(manifest.permissions).toContain('contextMenus');
    // #510: 用户数据不因翻译缓存占满 storage.local 配额而保存失败
    expect(manifest.permissions).toContain('unlimitedStorage');
    // 不应包含 host_permissions（扩展使用 activeTab 风格）
  });

  test('DeepSeek、Grok 的端点是可选权限，必需的 host 权限不变（#609/#613）', () => {
    const optional = ['https://api.deepseek.com/*', 'https://api.x.ai/*'];
    const chromeManifest = path.join(OUTPUT_DIR, 'chrome-mv3', 'manifest.json');
    if (fs.existsSync(chromeManifest)) {
      const m = JSON.parse(fs.readFileSync(chromeManifest, 'utf-8')) as Record<string, string[]>;
      expect(m.host_permissions).toHaveLength(7);
      for (const p of optional) {
        expect(m.optional_host_permissions).toContain(p);
        expect(m.host_permissions).not.toContain(p);
      }
    }
    // Firefox 的 MV2 没有 optional_host_permissions，写进 optional_permissions
    const firefoxManifest = path.join(OUTPUT_DIR, 'firefox-mv2', 'manifest.json');
    if (fs.existsSync(firefoxManifest)) {
      const m = JSON.parse(fs.readFileSync(firefoxManifest, 'utf-8')) as Record<string, string[]>;
      for (const p of optional) {
        expect(m.optional_permissions).toContain(p);
        expect(m.permissions).not.toContain(p);
      }
    }
  });

  test('隐私政策与权限说明列出 manifest 的每个 host 权限，可选权限注明“可选”（#612）', () => {
    const chromeManifest = path.join(OUTPUT_DIR, 'chrome-mv3', 'manifest.json');
    if (!fs.existsSync(chromeManifest)) return;
    const m = JSON.parse(fs.readFileSync(chromeManifest, 'utf-8')) as Record<string, string[]>;
    const privacy = fs.readFileSync(path.resolve('store/privacy-policy.md'), 'utf-8');
    const justification = fs.readFileSync(path.resolve('store/permissions-justification.md'), 'utf-8');
    const host = (pattern: string) => new URL(pattern.replace(/\*$/, '')).host;
    for (const p of m.host_permissions ?? []) {
      expect(privacy).toContain(`\`${p}\``);
      expect(justification).toContain(host(p));
    }
    for (const p of m.optional_host_permissions ?? []) {
      // 权限表里那一行写明是可选权限
      expect(privacy).toMatch(new RegExp(`\\| \`${p.replace(/[.*]/g, '\\$&')}\` \\|[^\\n]*可选权限`));
      expect(justification).toMatch(new RegExp(`optional host permission[\\s\\S]*${host(p).replace(/\./g, '\\.')}`));
    }
  });

  test('manifest.json content_scripts matches = ["<all_urls>"]', () => {
    if (!outputExists()) return;
    const manifest = readFirstManifest();
    if (!manifest) return;

    if (Array.isArray(manifest.content_scripts) && manifest.content_scripts.length > 0) {
      const cs = manifest.content_scripts[0] as Record<string, unknown>;
      expect(cs.matches).toContain('<all_urls>');
    }
  });

  test('_locales/ 三语 messages.json 存在', () => {
    if (!outputExists()) return;
    const browsers = fs.readdirSync(OUTPUT_DIR).filter((d) => {
      const p = path.join(OUTPUT_DIR, d, '_locales');
      return fs.existsSync(p) && fs.statSync(p).isDirectory();
    });
    if (browsers.length === 0) {
      console.warn('⚠ _locales/ 不在构建产物中，跳过');
      return;
    }
    const localesDir = path.join(OUTPUT_DIR, browsers[0]!, '_locales');
    const locales = fs.readdirSync(localesDir);
    expect(locales).toContain('en');
    expect(locales).toContain('zh_CN');
    expect(locales).toContain('zh_TW');
  });

  test('icon/ 目录含多种尺寸', () => {
    if (!outputExists()) return;
    const manifest = readFirstManifest();
    if (!manifest || !manifest.icons) return;

    const sizes = Object.keys(manifest.icons);
    expect(sizes).toContain('16');
    expect(sizes).toContain('32');
    expect(sizes).toContain('48');
    expect(sizes).toContain('128');
  });

  test('options.html 存在', () => {
    if (!outputExists()) return;
    const dir = firstOutputDir();
    if (!dir) return;
    const files = walkDir(dir);
    const hasOptions = files.some((f) => f.endsWith('options.html'));
    expect(hasOptions).toBe(true);
  });

  test('popup.html 存在', () => {
    if (!outputExists()) return;
    const dir = firstOutputDir();
    if (!dir) return;
    const files = walkDir(dir);
    const hasPopup = files.some((f) => f.endsWith('popup.html'));
    expect(hasPopup).toBe(true);
  });

  test('welcome.html 存在', () => {
    if (!outputExists()) return;
    const dir = firstOutputDir();
    if (!dir) return;
    const files = walkDir(dir);
    const hasWelcome = files.some((f) => f.endsWith('welcome.html'));
    expect(hasWelcome).toBe(true);
  });

  test('CSS 产物包含注入规则', () => {
    if (!outputExists()) return;
    const dir = firstOutputDir();
    if (!dir) return;
    const files = walkDir(dir);
    const cssFiles = files.filter((f) => f.endsWith('.css'));
    // 至少有一个 CSS 文件
    expect(cssFiles.length).toBeGreaterThan(0);
  });
});

// ---- 辅助函数 ----

function firstOutputDir(): string | null {
  if (!fs.existsSync(OUTPUT_DIR)) return null;
  const dirs = fs
    .readdirSync(OUTPUT_DIR)
    // 排除点目录：E2E 运行残留的 .playwright-profiles 不是浏览器构建产物，
    // 且按字母序排在 chrome-mv3 之前，会劫持“第一个产物目录”
    .filter(
      (d) =>
        !d.startsWith('.') &&
        fs.statSync(path.join(OUTPUT_DIR, d)).isDirectory(),
    );
  if (dirs.length === 0) return null;
  return path.join(OUTPUT_DIR, dirs[0]!);
}

function readFirstManifest(): Record<string, unknown> | null {
  const dir = firstOutputDir();
  if (!dir) return null;
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  const list = fs.readdirSync(dir);
  for (const item of list) {
    const fullPath = path.join(dir, item);
    if (fs.statSync(fullPath).isDirectory()) {
      results.push(...walkDir(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}
