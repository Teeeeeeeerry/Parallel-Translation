# CONTEXT — Parallel-Translation

轻量上下文:术语映射与跨会话约定。代码结构以源码注释为准。

## 术语映射(用户语言 ↔ UI ↔ 代码)

| 用户语言 | UI 文案(zh_CN / en) | 代码标识 |
|---|---|---|
| **逐段翻译** | 逐段翻译 / Translate on hover | `showParagraphBtn`(设置项)、`translateOne()`(翻译入口)、`createParaBtn()`(悬停按钮注入) |
| 全页翻译 | 翻译整页 | `togglePage()` |
| 划词翻译 | 翻译选中文本 | `translateSelection()` |

**逐段翻译**(2026-08-15 定名):设置 → 悬浮 UI → 「逐段翻译」开关。语义 = 光标悬停在文字上时出现翻译按钮,点击仅翻译该段。关闭即解绑悬停监听(不再检测),即时生效无需刷新。此前文案「段落悬停按钮」因与用户语言对不上导致「找不到开关」,已统一改名;`welcomeParaBtnDesc` 描述文案未改(功能说明,不含名称)。

## 约定

- 每个 issue 修复 PR 一并 bump `package.json` 最末位版本号
- 提交信息须说明根因(修复类);PR body 含问题 / 根因 / 修复 / 验证四段
