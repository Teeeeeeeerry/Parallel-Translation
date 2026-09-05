import { defineConfig } from 'wxt';

/**
 * wxt.config.ts 需要的 Vite Plugin 接口子集。
 *
 * 这里不从 'vite' 导入 Plugin 类型 —— vite 仅是 wxt 的传递依赖，
 * 在 CI 的 pnpm 严格解析下可能不可见。只声明本文件实际用到的成员即可。
 */
interface VitePlugin {
  name: string;
  resolveId(
    source: string,
    importer: string | undefined,
  ): string | null | undefined | void;
  load(id: string): string | null | undefined | void;
}

/**
 * Vite 插件：阻止测试文件进入构建产物。
 *
 * 测试文件（docs/testing/**）不应出现在浏览器扩展的 .output/ 中。
 * 此插件在 build 阶段检查每个被解析的模块，若路径命中 docs/testing/
 * 则直接抛出错误 —— 宁可构建失败也不让测试代码泄漏进用户下载的扩展包。
 */
function blockTestFiles(): VitePlugin {
  const BLOCKED = /[/\\]docs[/\\]testing[/\\]/;
  return {
    name: 'block-test-files',
    resolveId(source: string, importer: string | undefined) {
      if (BLOCKED.test(source)) {
        throw new Error(
          `[block-test-files] 测试文件不应被打包进扩展产物: ${source}\n` +
            `  导入方: ${importer ?? '(入口)'}\n` +
            `  如果这是误报，请检查导入路径。`,
        );
      }
      // importer 也可能命中文档目录
      if (importer && BLOCKED.test(importer)) {
        throw new Error(
          `[block-test-files] 从测试目录导入的模块不应被打包: ${importer}`,
        );
      }
      return null; // 不处理，交回默认解析
    },
    load(id: string) {
      if (BLOCKED.test(id)) {
        throw new Error(
          `[block-test-files] 测试文件被意外加载进构建: ${id}`,
        );
      }
      return null;
    },
  };
}

export default defineConfig({
  manifest: ({ browser }) => ({
    // 存在 _locales/ 时 default_locale 是硬性要求 —— 缺它 Chrome 会以
    // 「Localization used, but default_locale wasn't specified」拒绝加载整个扩展。
    default_locale: 'zh_CN',
    name: '__MSG_extName__',
    description: '__MSG_extDesc__',
    permissions: ['storage', 'contextMenus'],
    // #180: 引擎端点显式声明 host 权限 —— 不依赖各端点 ACAO 头
    // （Google/Bing 免 key 端点与 BYOK 端点均支持，声明后 options 页
    // testConnection 对 CORS 异常端点的探测也不再静默失败）
    host_permissions: [
      'https://translate.googleapis.com/*',
      'https://api-edge.cognitive.microsofttranslator.com/*',
      'https://edge.microsoft.com/translate/auth',
      'https://api.openai.com/*',
      'https://generativelanguage.googleapis.com/*',
      'https://api.deepl.com/*',
      'https://api-free.deepl.com/*',
    ],
    action: { default_title: '__MSG_extName__' },
    options_ui: { open_in_tab: true },
    icons: {
      16: '/icon/16.png',
      32: '/icon/32.png',
      48: '/icon/48.png',
      128: '/icon/128.png',
    },
    // Firefox 需要显式声明扩展 id，否则 AMO 拒收
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'parallel-translation@example.com',
          strict_min_version: '109.0',
        },
      },
    }),
  }),
  // Firefox 的 AMO 要求随扩展提交源码包，里面只需要能重现构建的东西。
  // 默认规则会把整个仓库塞进去 —— 文档、商店截图、设计稿，以及
  // docs/testing/logs/ 下每次跑测试都会重写的覆盖率与报告产物，
  // 合计约 4.3MB，对复现构建毫无用处，还让审核者多下载 20 倍体积。
  zip: {
    excludeSources: ['docs/**', 'store/**', 'design/**'],
  },
  vite: () => ({
    plugins: [blockTestFiles()],
  }),
});
