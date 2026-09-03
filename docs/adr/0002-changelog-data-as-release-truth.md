# changelog 数据即上架版本的唯一真相

本项目约定每个 issue 修复 PR 都 bump `package.json` 末位版本号,内部版本变动极频繁,而只有阶段性完成才上传扩展商店 —— 需要一个东西回答「当前这个版本号该不该弹更新提示」。决定不建 `CHANGELOG.md`、不打 git tag,改由 `src/changelog/` 数据文件中出现的版本号来定义哪些是上架版本:写了条目就弹,没写就不弹。这把「哪个版本值得打扰用户」与「你写没写更新说明」合并成同一个动作,不可能出现弹了却没内容、或有内容却没弹。

## 备选方案

- **git tag 标记上架点** —— 需要额外流程,且 tag 与弹窗内容仍要人工对齐,并未消除不一致的可能。
- **CHANGELOG.md 构建时解析** —— 要写并维护 Markdown 解析器,而 Markdown 结构不稳定;三语文案在 Markdown 里也难以表达。

## 影响

- `manifest.version` 与 changelog 条目的版本号字面不等时静默不弹,且无任何报错。构建期校验因此是必需项而非可选项。校验挂在 `pnpm zip`(打包上架)而非 `pnpm build`(日常开发构建) —— 日常构建时当前版本本就是没有条目的内部版本,无条件失败会让 `pnpm build` 永远红灯。与既有的 `.github/scripts/check-commit-conventions.sh` 同属「不靠人工把关」的一类。
- 开发模式下 `package.json` 的版本可能恰好命中某条已写好的条目,故另需 `import.meta.env.DEV` 跳过,否则 `pnpm dev` 每次热重载都会弹。
- 历史条目会长期累积在数据文件中,需要定期归档。
