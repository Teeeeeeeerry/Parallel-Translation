<p align="right"><a href="README.md">简体中文</a> · <strong>English</strong></p>

<p>
  <img alt="Parallel-Translation" src="public/icon/128.png" width="96">
</p>

# Parallel-Translation

Translating a whole foreign-language page is convenient, but once the original text is replaced, you can't tell when the translation is wrong. There's always a moment when you want to see the original, and having to switch translation off just for that is annoying. On top of that, technical terms get mangled, and translating the page's buttons and menus turns the whole layout into a mess.

So I built this extension to let me read comfortably, without having to think too hard. I'm sure I'm not the only one who wants that, so here it is for anyone who needs it.

## Install (30 seconds)

### 1. Get the extension

<details>
<summary><strong>Chrome / Edge</strong></summary>

```bash
pnpm install
pnpm build          # for Edge: pnpm build:edge
```

1. Open `chrome://extensions/` (Edge: `edge://extensions/`) and turn on "Developer mode"
2. Click "Load unpacked" and pick `.output/chrome-mv3/` (Edge: `.output/edge-mv3/`)

Pick the build output folder, not the project root. `.output` is hidden; press `Cmd+Shift+.` in the file picker to show it.

</details>

<details>
<summary><strong>Firefox</strong></summary>

```bash
pnpm install
pnpm build:firefox
```

Open `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on", and pick `.output/firefox-mv2/manifest.json`.

</details>

<details>
<summary><strong>For tinkerers</strong></summary>

```bash
pnpm install
pnpm dev            # for Firefox: pnpm dev:firefox
```

With hot reload. The package manager is locked to pnpm (the `packageManager` field), so don't use npm or yarn.

</details>

### 2. Pick an engine

It works with nothing filled in: Google and Bing need no key. For better translations, go to the "Engines" section of the settings page, enter your own key, and click "Test connection". The key is saved once the test succeeds.

### 3. Translate

Click the floating button at the bottom right of the page, or press `⇧⌘Y` (Windows: `Ctrl+Shift+Y`). Press it again to restore the original.

## Why I built this

When I read foreign-language pages, Google Translate keeps giving me problems that are harmless but really irritating. I switched to a similar extension for a while, but first it wanted me to sign in for more quota, and after I signed in the quota kept running out. That annoyed me enough to build my own. So what can this one do?

### #1: Keeps the original for you

> Translation has three difficulties: faithfulness, expressiveness, and elegance.
>
> Yan Fu, preface to his translation of *Evolution and Ethics*

**The problem**: Replace-style translation, like Google Translate, swaps whole paragraphs of the original for the translation. Nothing wrong with that as such, but without the original in front of you, how do you know it's right? I've been burned by this more than once, and there was nothing I could do about it.

**The fix**: The extension defaults to **side-by-side mode**: original on top, translation below, paragraph by paragraph. Three display modes, switchable any time:

- **Side by side**: when the translation looks off, the original is right there, no switching back and forth
- **Translation only**: classic replace-style, because keeping the original can make a page too cluttered
- **Single paragraph**: translates only the paragraph under your cursor, because sometimes you just didn't get one paragraph and there's no need to translate everything

There are six translation styles (faded, dimmed, underline, bold, italic, left border), and you can write your own CSS. Switching modes and styles only changes a class on `<html>`: no DOM changes, no requests.

### #2: Technical terms get mangled

**The problem**: On GitHub, a Chinese translation turns "PR" into "公关" (public relations) and "fork" into "叉子" (a dinner fork). A general-purpose engine has no idea what you're reading.

**The fix**: **Domains and terms**. A domain is a set of terms plus a set of sites it applies to; when you open a page, the first domain whose sites match is used. A term can have a fixed translation, or be marked "do not translate" so the original word stays as-is in the translation.

<details>
<summary>Example</summary>

The built-in "Software development (Simplified Chinese)" domain applies to github.com, gitlab.com and similar sites. Reading an issue, translated into Chinese:

- **Without the domain**: "请在合并公关之前更新叉子。" ("Please update the dinner fork before merging the public relations.")
- **With the domain**: "请在合并 PR 之前更新 fork。" ("Please update the fork before merging the PR.")

Terms match whole words, case-insensitively: "PR" doesn't match "price", but it still matches inside Chinese text with no spaces around it.

PS: It should work now, but I'm not sure there are no bugs left. Feedback welcome.

</details>

Terms apply to full-page, single-paragraph, and selection translation. AI engines get the terms that matched in the current batch written into the request; machine-translation engines enforce "do not translate" terms with placeholders, and after you turn on a switch, fixed translations apply too.

Terms can be exported to CSV and imported from CSV (UTF-8 or GBK, comma, semicolon or tab separated, header row optional), and you can create a new domain straight from a CSV file. In the toolbar popup you can switch domains temporarily, or tick "Always use on this site".

> [!TIP]
> A domain serves one target language only. To translate into another language, create another domain.

### #3: Things that shouldn't be translated get translated

**The problem**: Full-page translation also translates the navigation, code, file names, and @usernames, and then the whole page is a mess and I'm like #@*&%¥*......

**The fix**: Two layers of filtering.

- **While collecting text**: numbers, non-content areas, invisible elements, and screen-reader-only text are filtered out before any request is sent
- **Site page rules**: per site, declare three kinds of elements with CSS selectors
  - **Scope**: translate only these
  - **Exclude**: don't translate this block at all
  - **Keep original**: don't translate, but keep the original inside the translated sentence, e.g. @username

GitHub and YouTube have built-in rules, for example skipping the contribution graph and file names, and keeping repo names and usernames as original text. Your rules stack on top of the built-in ones, and you can turn off the built-in rules for a site. Invalid selectors are highlighted in red with the line number; rules can be exported and imported as JSON.

### #4: The engine is down, or out of quota

**The problem**: Every translation service has a bad day sometimes. With only one engine... if you need it right then, you're stuck......

**The fix**: **Multi-engine failover**.

- No key needed: Google, Bing
- Bring your own key: OpenAI, DeepL, Gemini, DeepSeek, Grok

Drag to reorder the priority; that order is the failover order. If an engine fails temporarily, the next one takes over; engines that don't support your target language are skipped; when a key is invalid or the quota is used up, you're told the real reason instead of every engine being tried.

AI engines are sent numbered batches and the results are filled back in by number. If the model drops a line, that paragraph stays empty, instead of every translation below it shifting by one and landing under the wrong paragraph.

### #5: "Hi, I don't want to hand you a pile of permissions for no reason"

**The problem**: Many extensions ask to "read and change all your data on all websites". You have no idea what they do with your pages. I've honestly gotten used to having no privacy online, but, uh, hmm......

**The fix**: **Minimal permissions**.

- Only three basic abilities: saving settings (with room for any number of terms), unlimited storage space, and a "Translate selected text" item in the right-click menu.
- It can reach only 7 translation addresses: the APIs of Google, Bing, OpenAI, DeepL, and Gemini. It can't reach any other website.
- DeepSeek and Grok need your approval first: you're not asked at install or update time; only when you enter their key and click "Test connection" does the browser ask whether to allow access to api.deepseek.com or api.x.ai. Say no, and the key isn't saved and the extension never connects.
- Until you click translate, it neither reads nor sends anything on the page.
- No data about you is collected: no analytics, no tracking, no logs. Text to translate goes only to the translation service you picked.
- Settings sync to your other devices through your browser account.
- Keys, terms, site rules, and past translations (deleted automatically after 30 days) stay on this computer only. **Keys never sync, and exported settings never include keys.**

[Full privacy policy](store/privacy-policy.md) (in Chinese)

### A few last words

Everyone has their own habits when it comes to translation, so I've tried to let everyone set things up their own way.

## Feature reference

### Ways to translate

- **Floating button**: click once to translate the page, again to restore. Of course you can drag it wherever you like
- **Toolbar button**: master switch, translate this page, current domain, engine, source and target language, display mode, style
- **Keyboard shortcuts**: translate page `⇧⌘Y`, toggle side-by-side / translation-only `⇧⌘M`, translate the paragraph under the cursor `⇧⌘D`, master switch `⇧⌘E`; on Windows, replace `⌘` with `Ctrl`. All of them are customizable, and while recording you're warned about combinations the browser reserves and duplicate bindings (but does anyone actually use extension shortcuts? I don't, hehe)
- **Single-paragraph translation**: a button appears at the end of the text when your cursor rests on it; click to translate or restore that paragraph
- **Selection translation**: select text and translate it from the right-click menu (I doubt anyone uses this, since the browser's built-in one is usually enough, but I built it anyway)

### Page compatibility

- **Text tucked away inside the page gets translated too**: whether the page puts text in separate self-contained blocks or in embedded frames from the same site, it's found and translated.
- **New content is translated automatically**: content loaded as you scroll, new pages that appear without a reload, and text that changes in place all get translated.
- **Page styles don't interfere**: the extension's own UI, like the floating button, and the page don't affect each other, so even unusual page styles won't break it, and the extension never translates its own button labels.

### Settings page

I don't really think this needs explaining, but just in case someone needs it, here you go:

<details>
<summary><strong>Settings page</strong></summary>

- **General**: on/off switch, languages, default display mode, floating UI
- **Engines**: drag to reorder priority, enable and disable, your own keys, model names, test connection
- **Appearance**: translation style, custom CSS with live preview
- **Hotkeys**, **Sites** (blocklist or allowlist), **Advanced** (concurrency, cache, export and import settings, restore defaults)
- **Domains**, **Site rules**: see #2 and #3 above

</details>

### Odds and ends

- **Three UI languages**: Simplified Chinese, Traditional Chinese, English, following your browser's UI language
- **Feedback**: one click at the bottom of the popup takes you to GitHub to report an issue

## Development

Stack: WXT + TypeScript + Vite.

| Command | Description |
|---|---|
| `pnpm dev` / `pnpm dev:firefox` | Dev mode with hot reload |
| `pnpm build` / `build:firefox` / `build:edge` | Production build |
| `pnpm zip` / `zip:firefox` / `zip:edge` | Zip for store submission |
| `pnpm typecheck` | TypeScript type check |
| `pnpm test` | Unit tests |
| `pnpm test:coverage` | Unit tests + coverage thresholds |
| `pnpm test:e2e` / `test:e2e:core` | E2E tests (run `pnpm build` first) |

Status: v2.0 is release-ready and still being improved. 1,300+ unit tests (with coverage thresholds) and 60+ core E2E tests run on every push in CI; 300+ issues completed so far.

Conventions:

- `main` requires linear history; every change goes in through a PR (squash or rebase), no merge commits
- CSS classes, DOM `data-` attributes, and storage keys all use the `pt-` / `pt` prefix
- Colors and typography always reference the design tokens in [`src/styles/tokens.css`](src/styles/tokens.css); **never hard-code colors in components**

Full requirements: [global requirements in the phase index](docs/phases/README.md#全局要求) (in Chinese).

| Doc | Contents |
|---|---|
| [CONTEXT.md](CONTEXT.md) | Glossary: definitions of single-paragraph translation, domains, terms, site page rules, etc. |
| [docs/adr/](docs/adr/) | Architecture decision records: hard-to-reverse trade-offs that would look arbitrary if not written down |
| [docs/phases/README.md](docs/phases/README.md) | Phase index and dependency graph |
| [docs/phases/](docs/phases/) | 9 phase handbooks: code skeletons, rationale, acceptance criteria |
| [docs/DoD-report/](docs/DoD-report/) | DoD acceptance report for each phase |
| [docs/TESTING.md](docs/TESTING.md) | Test system: layering, performance and memory, errors and edge cases, privacy and compliance |
| [store/](store/) | Store listing materials |

The docs above are written in Chinese.

## License

[GNU General Public License v3](LICENSE) (GPL-3.0-or-later).

    Parallel-Translation - a side-by-side web page translation browser extension
    Copyright (C) 2026 Parallel-Translation contributors

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program. If not, see <https://www.gnu.org/licenses/>.

In short: you can use, modify, and redistribute it freely, but if you distribute a derivative work (including a modified version published to a store), you must release its full source code under GPL-3.0 as well.
