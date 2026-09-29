上架材料：下一个上架版本的待写更新说明（#525）。

下一个上架版本号还没定，更新提示的条目先写在这里。按 ADR-0002，changelog
条目的版本号就是上架版本 —— 提前写进 `src/changelog/data.ts` 会让某个
内部版本意外弹出更新提示。

上架时：

1. 把下面的“更新提示”各项并入 `src/changelog/data.ts` 新条目对应的分组。
2. 把“AMO 版本说明”填进 Firefox 附加组件商店本次版本的版本说明。
3. 清空本文件“待写条目”以下的内容（保留这段说明）。

================================================================
待写条目
================================================================

----------------------------------------------------------------
[improve] 新增 unlimitedStorage 权限（#510）
----------------------------------------------------------------

更新提示（changelog 条目，分组 improve）：

- title
  - zh_CN：本地存储空间不再受限
  - zh_TW：本機儲存空間不再受限
  - en：No more local storage limit
- desc
  - zh_CN：扩展新申请了“无限存储”权限。翻译缓存、术语和站点规则都只存在你的浏览器本地，不会上传；有了这项权限，上千条术语也不会因为空间不足而保存失败。翻译缓存仍有自己的上限，满了会先删最旧的。
  - zh_TW：擴充功能新申請了「無限儲存」權限。翻譯快取、術語和網站規則都只存在你的瀏覽器本機，不會上傳；有了這項權限，上千條術語也不會因為空間不足而儲存失敗。翻譯快取仍有自己的上限，滿了會先刪最舊的。
  - en：The extension now requests the unlimited storage permission. The translation cache, your terms and your site rules are kept only in your browser and never uploaded; with this permission, thousands of terms no longer fail to save for lack of space. The translation cache still has its own size limit and drops the oldest entries first.

AMO 版本说明（Firefox 升级前会请求确认新权限，用户在确认前能看到这段）：

- en：

  This version requests one new permission, "Store unlimited amount of client-side data" (unlimitedStorage). The translation cache, your terms and your site rules are all stored locally in your browser. With thousands of terms, the default storage quota could fill up and saving would fail; this permission removes that limit. Nothing is uploaded, and the data never leaves your browser. The translation cache still has its own size limit and drops the oldest entries first.

- zh_CN：

  这个版本新申请了一项权限 unlimitedStorage（Firefox 显示为存储不限量的客户端数据）。翻译缓存、术语和站点规则都存在你的浏览器本地。术语多到几千条时，默认的存储配额可能用满，保存就会失败；这项权限去掉了这个上限。数据不会上传，也不会离开你的浏览器。翻译缓存仍有自己的上限，满了会先删最旧的。
