import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Parallel-Translation',
    description: '对照式网页翻译扩展',
    permissions: ['storage'],
    action: { default_title: 'Parallel-Translation' },
    options_ui: { open_in_tab: true },
    icons: {
      16: '/icon/16.svg',
      32: '/icon/32.svg',
      48: '/icon/48.svg',
      128: '/icon/128.svg',
    },
  },
});
