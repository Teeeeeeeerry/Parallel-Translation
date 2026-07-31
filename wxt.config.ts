import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: ({ browser }) => ({
    // 存在 _locales/ 时 default_locale 是硬性要求 —— 缺它 Chrome 会以
    // 「Localization used, but default_locale wasn't specified」拒绝加载整个扩展。
    default_locale: 'zh_CN',
    name: '__MSG_extName__',
    description: '__MSG_extDesc__',
    permissions: ['storage', 'contextMenus'],
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
});
