Store listing copy for the Chrome Web Store (English).
The store's description box is plain text and does not render Markdown —
copy the two sections below as-is; adding ** or ## will show up literally.

================================================================
[SUMMARY] Paste into the "Summary" field. Limit: 132 characters
================================================================

Read the original and its translation side by side. Multiple engines, adjustable styling, no data collected.

================================================================
[DESCRIPTION] Paste into the "Description" field. Limit: 16000 characters
================================================================

The original and its translation, side by side. No more jumping between two windows.

Most translation extensions replace the original text, so checking it against the translation means toggling back and forth. This one keeps both languages on screen at once. Whether you are learning a language, reading a paper, or following the news, you can always see what a sentence actually said.

How to use it

Six ways to start, whichever suits you:
· The floating button at the edge of the page, which translates everything in one click
· The panel behind the toolbar icon
· Keyboard shortcuts for full-page translation, display mode, single paragraph, and the master switch, all remappable
· Hover over a paragraph and a button appears, translating just that one
· Select text and right-click
· Drag the cursor while holding a modifier key

How it looks

Side by side: the original on top, the translation below, paragraph for paragraph.
Translation only: the conventional replace-the-text approach, one click away.
Single paragraphs can use a different display mode from the full page.

Six styles for the translation: translucent (the default, keeping it unobtrusive), dimmed (appears on hover), underlined, bold, italic, and left-bordered. You can also write your own CSS, which applies only to the translation and cannot touch the page itself.

Engines

Google and Bing work out of the box. No sign-up, no API key.
For higher quality, bring your own key for OpenAI, DeepL or Gemini.
Engines fail over in the order you set: if one fails the next takes over, and any that lack your target language are skipped rather than tried and wasted.

Page coverage

Reaches into Shadow DOM and same-origin iframes, so sites built on Web Components are covered.
Content arriving from infinite scroll or SPA navigation is translated as it appears.
Numbers, navigation bars and other non-article areas are filtered out before any request, so they never cost you quota.
The injected interface is isolated behind Shadow DOM in both directions, so it holds its shape even on sites with aggressive CSS resets.

Privacy

No personal data is collected. No analytics, no tracking, no remote logging.
Only two permissions are requested: local storage and context menus. Network requests go solely to the translation service you picked, with nothing in between.
API keys are stored locally, are never synced to your browser account, and are never included when you export your settings.
The content script is present on every page, but reads and sends nothing until you actively ask for a translation.

Also

A site allowlist and blocklist, so you decide where the extension runs.
The interface speaks Simplified Chinese, Traditional Chinese and English, following your browser's language.
After an update, the next page you open tells you what changed. It shows once and never again.
Found a problem? There is a link at the bottom of the toolbar panel.

Open source under the GNU GPL v3. Code and issues:
https://github.com/Teeeeeeeerry/Parallel-Translation
