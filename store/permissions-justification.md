上架材料：Chrome Web Store「Privacy practices」分页的权限理由。
审核员会拿这些文字对照 manifest 与实际行为，改动权限后必须同步更新此文件。
全部用英文填写（审核界面与审核员语言）。

================================================================
[storage] Justification
================================================================

All data is stored locally in the browser and none of it is transmitted anywhere.

storage is used for four things:

1. User settings (chrome.storage.sync) — target language, display mode (side-by-side or translation-only), translation styling, engine priority order, keyboard shortcuts, and the site allowlist/blocklist. These must survive browser restarts and follow the user across their signed-in browsers.

2. Optional API keys (chrome.storage.local) — if a user chooses to bring their own key for OpenAI, DeepL or Gemini, it is kept here. The local area is used deliberately so that keys never leave the device through browser account sync, and they are excluded when the user exports their settings.

3. Translation cache (chrome.storage.local) — translated text is cached for 30 days, so revisiting a page does not re-request the same sentences. This saves the user's API quota and reduces load on the translation service.

4. One flag recording which version's release notes have already been shown, so that notice appears once and is not repeated.

No browsing history, page content, or personal information is stored. Without this permission the extension could not remember a single setting and would reset to defaults on every page load.

================================================================
[contextMenus] Justification
================================================================

The extension adds exactly one context menu item, "Translate selected text", registered with contexts: ["selection"] so that it appears only when the user has selected text on a page.

Choosing it sends the selected text to the translation engine the user has configured and displays the result in place. This is one of the extension's documented ways to start a translation, alongside the toolbar panel, the floating button, keyboard shortcuts, and hovering a paragraph.

The extension creates no other menu items and neither reads nor modifies any other part of the context menu.

================================================================
[Host permissions] Justification —— 后续大概率也会被要求填写
================================================================

Every host permission is the API endpoint of one translation service the user can select:

- translate.googleapis.com — Google translation, the default engine, no API key required
- api-edge.cognitive.microsofttranslator.com and edge.microsoft.com — Bing/Edge translation, no API key required
- api.openai.com — OpenAI, used only when the user supplies their own API key
- generativelanguage.googleapis.com — Google Gemini, used only with the user's own key
- api.deepl.com and api-free.deepl.com — DeepL, used only with the user's own key

The extension sends only the text the user asked to have translated, and only to the engine currently selected. These endpoints are declared explicitly rather than requesting broad host access, and no other network destination is ever contacted.

================================================================
[Single purpose] 描述 —— 后续大概率也会被要求填写
================================================================

This extension translates web page text and shows the translation alongside the original, so that a foreign-language page can be read without switching between two windows. Every feature — the toolbar panel, the floating button, keyboard shortcuts, paragraph hover, and right-click translation — exists to trigger or configure that single task.

================================================================
其余分页的填法（依据代码事实，非文案）
================================================================

- Remote code: 选「No, I am not using remote code」。扩展不加载任何远程脚本，
  全部代码打包在扩展内。
- Data usage: 所有类别都不勾选。扩展不收集、不传输、不出售任何用户数据；
  待翻译文本直接发往用户自选的翻译服务，不经过任何自有服务器。
  三项声明（不出售、不用于无关用途、不用于信用评估）均可勾选确认。
