import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Parallel-Translation',
    description: '对照式网页翻译扩展',
    permissions: ['storage'],
    action: { default_title: 'Parallel-Translation' },
    options_ui: { open_in_tab: true },
    icons: {
      16: '/icon/16.png',
      32: '/icon/32.png',
      48: '/icon/48.png',
      128: '/icon/128.png',
    },
  },
});
