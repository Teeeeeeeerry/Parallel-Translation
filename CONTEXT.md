# CONTEXT — Parallel-Translation

轻量上下文:术语映射与跨会话约定。代码结构以源码注释为准。

## 术语映射(用户语言 ↔ UI ↔ 代码)

| 用户语言 | UI 文案(zh_CN / en) | 代码标识 |
|---|---|---|
| **逐段翻译** | 逐段翻译 / Translate on hover | `showParagraphBtn`(设置项)、`translateOne()`(翻译入口)、`createParaBtn()`(悬停按钮注入) |
| 全页翻译 | 翻译整页 | `togglePage()` |
| 划词翻译 | 翻译选中文本 | `translateSelection()` |
| **更新提示** | 更新内容 / What's New | `src/changelog/`(数据与渲染)、`pt-changelog`(storage key) |
| **领域** | 翻译领域 | `Domain`、`src/storage/domains.ts`(生效领域列表、`currentDomain()` 当前领域解析)、`src/storage/builtin-domains.ts`(内置领域数据)、`TranslateRequest.domainId` |
| **术语** | 术语 | `Term`(`noTranslate` = 不翻译) |
| **站点页面规则** | 站点规则 | `SiteRules`、`src/storage/specialization.ts`(`getSiteRules()` 生效站点规则;`UserSiteRules` 用户规则,存 storage.local,页面先 `siteRulesReady()` 载入)、`src/storage/builtin-site-rules.ts`(内置规则数据);限定范围与排除在全页翻译的 `collect()` 与逐段翻译的 `closestUnit()` 两个入口生效;代码层为 `src/dom/compat.ts` |

**逐段翻译**(2026-08-15 定名):设置 → 悬浮 UI → 「逐段翻译」开关。语义 = 光标悬停在文字上时出现翻译按钮,点击仅翻译该段。关闭即解绑悬停监听(不再检测),即时生效无需刷新。此前文案「段落悬停按钮」因与用户语言对不上导致「找不到开关」,已统一改名;`welcomeParaBtnDesc` 描述文案未改(功能说明,不含名称)。

**更新提示**(2026-09-03 定名):扩展更新到新的上架版本后,用户下次打开新页面时在页面内弹出的变更说明。语义 = 只告知本次上架版本改了什么;引导教学是首装欢迎页的职责,两者共存不合并。UI 标题作「更新内容」,对话与 issue 中称「更新提示」,代码一律 `changelog`。

**上架版本 / 内部版本**(2026-09-03 定名):**内部版本**指每个 issue 修复 PR 都会 bump 的 `package.json` 末位版本号,变动频繁,绝大多数从未离开仓库;**上架版本**指真正传到扩展商店、用户能装到的版本。二者共用同一个版本号字段,区分方式见 ADR-0002。

**领域**(2026-09-22 定名):一组**术语**加一组适用网址,例如「软件开发」领域带着 issue / PR / fork 的译法,适用于 github.com、gitlab.com。领域按内容组织,站点只是它的触发条件;网址没命中时用户可以手动选择领域。一个领域只服务一种目标语言,要翻成别的语言就另建一个领域。一个页面同时只有一个**当前领域**:取领域列表里第一个命中网址的;用户也可以在 popup 里临时切换,并选择以后在这个站点都使用它。内置几份领域由本项目自行编写,用户可以修改,也可以新建;用户对内置领域的修改会保留下来,扩展升级带来的新内置内容照样生效。领域目前不含翻译说明(提示词),以后可以作为新字段加进来。_避免_:翻译专家、AI 专家(沉浸式翻译的叫法)、预设、翻译风格。

**术语**(2026-09-22 定名):领域里的一条对照,由原词和译法组成;也可以标记为「不翻译」,即原词原样出现在译文里。全页翻译、逐段翻译、划词翻译都生效,AI 引擎和机翻引擎也都生效;对机翻引擎,「不翻译」类术语默认生效,指定了译法的术语默认不生效,需要用户打开。_避免_:词汇表、glossary(DeepL 的账户级资源,和这里不是一回事)、保持原文(和站点页面规则的「保留原文」撞名)。

**站点页面规则**(2026-09-22 定名):按站点声明页面上的三类元素:**限定范围**(只翻译这些)、**排除**(整块不翻译)、**保留原文**(不翻译,但原文留在译文句子里,例如 @用户名)。它管的是「翻哪些文字」,不管「怎么翻」,因此只作用于全页翻译和逐段翻译,不作用于划词翻译;所以按站点组织,不归属领域。有内置和用户两个来源:用户规则叠加在内置规则之上,用户也可以停用某个站点的内置规则。_避免_:站点适配、compat 补丁(那是规则的代码层,见 ADR-0003)。

## 约定

- 每个 issue 修复 PR 一并 bump `package.json` 最末位版本号
- 提交信息须说明根因(修复类)与来源 issue 编号,便于追溯;PR body 含问题 / 根因 / 修复 / 验证四段
- **小改动不夹带大文件**:提交内容须与提交信息描述的范围一致;测试基础设施新建 / 迁移应有独立提交并写明规格来源(#137)
- **输出不使用 emoji 表情符号**(对话 / issue / PR / 注释一律不用;状态标记写成文字,如「通过 / 失败」)
- **提交信息 CI 校验**(#138):fix 类提交信息须含根因箭头(「→」或「—」)与 issue 编号(#N);含 fix 提交的 PR 须 bump `package.json` 版本号。校验脚本 `.github/scripts/check-commit-conventions.sh`,PR 时自动运行,避免人工把关遗漏
- **并行开发用独立 worktree**(#420):多个会话同时开发时,每个会话在自己的 git worktree 里建分支、提交、rebase;共用目录(仓库主目录)只停在 main 上,不在里面切换分支或改写历史(`switch`、`reset`、`rebase`、`commit --amend` 等)。曾有一条命令链在 `cd` 失败后继续执行,`git reset --hard` 落在了共用目录的 main 上。
  - 建立:`git -C <主目录> fetch origin && git -C <主目录> worktree add --no-track -b feat/<分支名> ../pt-<ISSUE> origin/main`(相对路径按 `-C` 指定的主目录解析,不受当前目录影响),进入后先 `pnpm install`(每个 worktree 有自己的 `node_modules` 与 `.output/`)。`--no-track` 避免新分支以 `origin/main` 为上游。
  - 合并与清理,按这个顺序:`git -C <主目录> worktree remove ../pt-<ISSUE>`(工作区须已提交并推送)→ `cd <主目录> && gh pr merge <PR> --squash --delete-branch`(主目录停在 main,gh 删本地分支时不必切换分支;在 worktree 里执行会因 main 已在主目录检出而报错)→ `gh pr view <PR> --json state` 确认为 `MERGED`,远端分支还在就 `git -C <主目录> push origin --delete feat/<分支名>`,本地分支还在就 `git -C <主目录> branch -D feat/<分支名>`(squash 合并后分支不是 main 的祖先,`-d` 会拒绝;所以必须先确认 `MERGED` 再删)→ `git -C <主目录> pull --ff-only`。合并失败时分支仍在,用 `worktree add`(不带 `-b`)重新检出即可。
  - 对共用目录执行破坏性 git 命令时,用 `git -C <目录>` 指定目录,不依赖前面 `cd` 的结果;命令链用 `&&` 连接,前一步失败即停。
