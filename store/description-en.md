# Parallel-Translation — Bilingual Web Translation Extension

**See original and translation side by side. No more toggle, no more context switching.**

## Why Parallel-Translation

Traditional translation extensions replace the original text with translations. To compare with the source, you have to toggle back and forth constantly. Parallel-Translation displays **both versions together** — original above, translation below — so you can read in two languages simultaneously. Ideal for language learners, researchers, and anyone who reads international content.

## Core Features

- **Bilingual Mode**: Original text above, translation below, perfectly aligned
- **Translation-Only Mode**: Traditional replacement view, one-click toggle
- **6 Translation Styles**: Translucent (default), dimmed, underlined, bold, italic, left-bordered — instantly distinguish translation from original
- **Multi-Engine Support**: Google Translate & Bing Translate work out of the box; bring your own OpenAI, DeepL, or Gemini key for higher quality
- **Smart Failover**: Primary engine fails? Automatically switches to the next in priority order
- **Floating Ball & Paragraph Buttons**: Toggle translation, switch modes, translate current paragraph without leaving the page
- **Global Hotkeys**: Translate page, toggle mode, translate paragraph, toggle extension — all customizable
- **Selection Translation**: Right-click or drag-to-translate any selected text
- **Site Allowlist/Blocklist**: Control exactly where the extension runs
- **i18n**: UI available in Simplified Chinese, Traditional Chinese, and English
- **Zero Data Collection**: No analytics, no logging, no tracking. API keys stored locally only, never synced

## Technical Highlights

- Built on WXT framework, Manifest V3, fully written in TypeScript
- Shadow DOM isolated UI injection — zero style conflicts with host pages
- TreeWalker + shadowRoot recursive traversal for Web Components & iframe support
- Cross-site translation cache — same text translated once, reused everywhere

## Browser Support

Chrome · Edge · Firefox (Manifest V3)

## Open Source

https://github.com/Teeeeeeeerry/Parallel-Translation

(License pending)
