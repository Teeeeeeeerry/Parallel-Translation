# Parallel-Translation 隐私政策

**最后更新日期：2026-08-01**

## 数据收集

Parallel-Translation **不收集任何个人信息**。本扩展：

- 无分析/统计埋点
- 无远程日志上报
- 无用户行为追踪
- 无第三方广告 SDK

## 数据流向

用户选中或在页面上可见的待翻译文本，会被发送至用户所选的翻译服务提供方以获取译文。具体端点取决于用户在设置中选择的翻译引擎：

| 引擎 | 目标服务 | 隐私政策 |
|------|---------|---------|
| Google 翻译 | translate.googleapis.com | [Google 隐私权政策](https://policies.google.com/privacy) |
| Bing 翻译 | api-edge.cognitive.microsofttranslator.com | [Microsoft 隐私声明](https://privacy.microsoft.com/zh-cn/privacystatement) |
| OpenAI | api.openai.com（或用户配置的自定义端点） | [OpenAI 隐私政策](https://openai.com/policies/privacy-policy) |
| DeepL | api.deepl.com / api-free.deepl.com | [DeepL 隐私政策](https://www.deepl.com/privacy) |
| Gemini | generativelanguage.googleapis.com | [Google 隐私权政策](https://policies.google.com/privacy) |

**重要提示**：使用 BYOK 引擎（OpenAI / DeepL / Gemini）时，文本会直接发送至对应的第三方服务，请同时参考该服务的隐私政策。

## 本地存储

以下数据存储在您的浏览器本地，**不会上传到任何服务器**：

| 存储区域 | 内容 | 是否参与浏览器同步 |
|---------|------|------------------|
| `chrome.storage.sync` | 用户设置（语言偏好、显示模式、样式等） | 是（跟随浏览器账号） |
| `chrome.storage.local` | 翻译缓存 | 否 |
| `chrome.storage.local` | API 密钥（OpenAI / DeepL / Gemini） | **否（明确不参与云端同步）** |

API 密钥以明文形式存储在 `chrome.storage.local` 中，仅用于向对应翻译服务发起 API 请求时的认证。**密钥不会随浏览器账号同步到其他设备。**

## 权限用途

本扩展仅申请以下两项权限：

| 权限 | 用途 |
|------|-----|
| `storage` | 保存用户设置、翻译缓存与 API 密钥 |
| `contextMenus` | 提供右键菜单中的「翻译选中文本」功能 |

本扩展**不申请 `host_permissions`** —— 不对任何网站持有持续访问权限。

内容脚本以 `content_scripts` 静态声明的方式在所有页面运行（`matches: ["<all_urls>"]`）。但它在用户主动触发翻译之前**不读取、不发送任何页面内容**：脚本加载后只注册消息监听与快捷键，页面文本的采集与外发全部发生在用户点击翻译按钮、悬浮球、段落按钮、右键菜单或按下快捷键之后。

## 第三方服务

本扩展不嵌入任何第三方 SDK。所有翻译请求由扩展自身代码通过标准 `fetch` API 直接发起。

## 儿童隐私

本扩展不面向 13 岁以下儿童，不会故意收集儿童的个人信息。

## 政策更新

本隐私政策可能随扩展功能更新而修订。重大变更将通过扩展更新说明告知。

## 联系方式

如有隐私相关问题，请通过 GitHub Issues 联系：
https://github.com/Teeeeeeeerry/Parallel-Translation/issues
