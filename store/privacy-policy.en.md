<p align="right"><a href="privacy-policy.md">简体中文</a> · <strong>English</strong></p>

# Parallel-Translation Privacy Policy

**Last updated: 2026-10-02**

## Data collection

Parallel-Translation **does not collect any personal information**. This extension has:

- No analytics or tracking code
- No remote logging
- No user behavior tracking
- No third-party advertising SDKs

## Where data goes

Text that you select, or that is visible on the page and is to be translated, is sent to the translation provider you chose in order to get the translation. The endpoint depends on the translation engine selected in the settings:

| Engine | Service | Privacy policy |
|--------|---------|----------------|
| Google Translate | translate.googleapis.com | [Google Privacy Policy](https://policies.google.com/privacy) |
| Bing Translator | api-edge.cognitive.microsofttranslator.com; edge.microsoft.com (only to obtain a short-lived access token; no text to translate is sent) | [Microsoft Privacy Statement](https://privacy.microsoft.com/en-us/privacystatement) |
| OpenAI | api.openai.com | [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy) |
| DeepL | api.deepl.com / api-free.deepl.com | [DeepL Privacy Policy](https://www.deepl.com/privacy) |
| Gemini | generativelanguage.googleapis.com | [Google Privacy Policy](https://policies.google.com/privacy) |
| DeepSeek | api.deepseek.com | [DeepSeek Privacy Policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html) |
| Grok | api.x.ai | [xAI Privacy Policy](https://x.ai/legal/privacy-policy) |

**Important**: When you use a bring-your-own-key engine (OpenAI / DeepL / Gemini / DeepSeek / Grok), text is sent directly to that third-party service. Please also read that service's privacy policy.

## Local storage

The following data is stored locally in your browser and is **never uploaded to any server**:

| Storage area | Contents | Synced by the browser? |
|--------------|----------|------------------------|
| `chrome.storage.sync` | Settings (language preferences, display mode, style, etc.) | Yes (follows your browser account) |
| `chrome.storage.local` | Translation cache | No |
| `chrome.storage.local` | API keys (OpenAI / DeepL / Gemini / DeepSeek / Grok) | **No (explicitly excluded from cloud sync)** |
| `chrome.storage.local` | Domains and terms (domains you create, and your changes to the terms and sites of the built-in domains) | No |
| `chrome.storage.local` | Site page rules (the scope, exclude, and keep-original rules you add for each site) | No |

API keys are stored in plain text in `chrome.storage.local` and are used only to authenticate API requests to the corresponding translation service. **Keys are never synced to your other devices through your browser account.**

Domains, terms, and site page rules are not synced through your browser account either. To move to another device, export terms as CSV and site page rules as JSON on the settings page, then import them on the other device. Uninstalling the extension deletes all data stored in `chrome.storage.local`.

## Permissions

The extension requests these three permissions:

| Permission | Purpose |
|------------|---------|
| `storage` | Save settings, the translation cache, API keys, domains and terms, and site page rules |
| `unlimitedStorage` | Remove the default local storage quota so thousands of terms and site page rules can be saved; the data stays local and is never uploaded |
| `contextMenus` | Provide the "Translate selected text" item in the right-click menu |

In addition, the extension requests `host_permissions` (listed under `permissions` in the Firefox version) for the translation services' API addresses. There are only these 7; it holds no access to any other website:

| Address | Purpose |
|---------|---------|
| `https://translate.googleapis.com/*` | Google Translate (default engine, no API key required) |
| `https://api-edge.cognitive.microsofttranslator.com/*` | Bing Translator (no API key required) |
| `https://edge.microsoft.com/translate/auth` | Bing Translator short-lived access token; no text to translate is sent |
| `https://api.openai.com/*` | OpenAI, used only after you enter your own API key |
| `https://generativelanguage.googleapis.com/*` | Gemini, used only after you enter your own API key |
| `https://api.deepl.com/*` | DeepL, used only after you enter your own API key |
| `https://api-free.deepl.com/*` | DeepL Free, used only after you enter your own API key |

There are also 2 **optional permissions** (`optional_host_permissions` in the Chrome version, `optional_permissions` in the Firefox version). They are not requested at install or update time. Only when you enter a DeepSeek or Grok API key and click "Test connection" to save it does the browser ask whether to allow access to that address; if you decline, the key is not saved and the address is never contacted. Once granted, you can revoke them at any time in the browser's extension settings:

| Address | Purpose |
|---------|---------|
| `https://api.deepseek.com/*` | DeepSeek, optional permission, used only after you enter your own API key and grant access |
| `https://api.x.ai/*` | Grok (xAI), optional permission, used only after you enter your own API key and grant access |

The extension sends requests to these addresses only when you use the corresponding engine. The requests contain only the text to translate and the parameters needed for translation (for example, the target language and your own API key).

The content script is declared statically in `content_scripts` and runs on all pages (`matches: ["<all_urls>"]`). However, **it does not read or send any page content until you start a translation yourself**: after loading, the script only registers message listeners and keyboard shortcuts. Collecting and sending page text happens only after you click the translate button, the floating button, a paragraph button, the right-click menu item, or press a keyboard shortcut.

## Third-party services

The extension does not embed any third-party SDK. All translation requests are made directly by the extension's own code using the standard `fetch` API.

## Children's privacy

The extension is not directed at children under 13 and does not knowingly collect personal information from children.

## Changes to this policy

This privacy policy may be revised as the extension's features change. Significant changes will be announced in the extension's release notes.

## Contact

For privacy questions, please contact us through GitHub Issues:
https://github.com/Teeeeeeeerry/Parallel-Translation/issues

If this English version differs from the [Simplified Chinese version](privacy-policy.md), the Chinese version prevails.
