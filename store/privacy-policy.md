<p align="right"><strong>简体中文</strong> · <a href="privacy-policy.en.md">English</a></p>

# Parallel-Translation 隐私政策

**最后更新日期：2026-10-02**

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
| Bing 翻译 | api-edge.cognitive.microsofttranslator.com；edge.microsoft.com（仅获取短期访问令牌，不发送待翻译文本） | [Microsoft 隐私声明](https://privacy.microsoft.com/zh-cn/privacystatement) |
| OpenAI | api.openai.com | [OpenAI 隐私政策](https://openai.com/policies/privacy-policy) |
| DeepL | api.deepl.com / api-free.deepl.com | [DeepL 隐私政策](https://www.deepl.com/privacy) |
| Gemini | generativelanguage.googleapis.com | [Google 隐私权政策](https://policies.google.com/privacy) |
| DeepSeek | api.deepseek.com | [DeepSeek 隐私政策](https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html) |
| Grok | api.x.ai | [xAI 隐私政策](https://x.ai/legal/privacy-policy) |

**重要提示**：使用 BYOK 引擎（OpenAI / DeepL / Gemini / DeepSeek / Grok）时，文本会直接发送至对应的第三方服务，请同时参考该服务的隐私政策。

## 本地存储

以下数据存储在您的浏览器本地，**不会上传到任何服务器**：

| 存储区域 | 内容 | 是否参与浏览器同步 |
|---------|------|------------------|
| `chrome.storage.sync` | 用户设置（语言偏好、显示模式、样式等） | 是（跟随浏览器账号） |
| `chrome.storage.local` | 翻译缓存 | 否 |
| `chrome.storage.local` | API 密钥（OpenAI / DeepL / Gemini / DeepSeek / Grok） | **否（明确不参与云端同步）** |
| `chrome.storage.local` | 领域与术语（用户新建的领域，以及对内置领域的术语和适用网址所做的修改） | 否 |
| `chrome.storage.local` | 站点页面规则（用户为各网站添加的限定范围、排除与保留原文规则） | 否 |

API 密钥以明文形式存储在 `chrome.storage.local` 中，仅用于向对应翻译服务发起 API 请求时的认证。**密钥不会随浏览器账号同步到其他设备。**

领域、术语与站点页面规则同样不随浏览器账号同步。换设备时，可以在设置页把术语导出为 CSV、把站点页面规则导出为 JSON，再到另一台设备导入。卸载扩展会删除存在 `chrome.storage.local` 里的全部数据。

## 权限用途

本扩展申请以下三项权限：

| 权限 | 用途 |
|------|-----|
| `storage` | 保存用户设置、翻译缓存、API 密钥、领域与术语、站点页面规则 |
| `unlimitedStorage` | 取消本地存储的默认配额，上千条术语与站点页面规则也能保存；数据只存在本地，不上传 |
| `contextMenus` | 提供右键菜单中的“翻译选中文本”功能 |

另外，本扩展为翻译服务的接口地址申请 `host_permissions`（Firefox 版写在 `permissions` 里），只有下列 7 个，不对其他任何网站持有访问权限：

| 地址 | 用途 |
|------|-----|
| `https://translate.googleapis.com/*` | Google 翻译（默认引擎，无需 API 密钥） |
| `https://api-edge.cognitive.microsofttranslator.com/*` | Bing 翻译（无需 API 密钥） |
| `https://edge.microsoft.com/translate/auth` | Bing 翻译获取短期访问令牌，不发送待翻译文本 |
| `https://api.openai.com/*` | OpenAI，仅在用户填入自己的 API 密钥后使用 |
| `https://generativelanguage.googleapis.com/*` | Gemini，仅在用户填入自己的 API 密钥后使用 |
| `https://api.deepl.com/*` | DeepL，仅在用户填入自己的 API 密钥后使用 |
| `https://api-free.deepl.com/*` | DeepL 免费版，仅在用户填入自己的 API 密钥后使用 |

此外还有 2 个**可选权限**（Chrome 版写在 `optional_host_permissions`，Firefox 版写在 `optional_permissions`）。安装和升级扩展时不申请，只在用户填入 DeepSeek 或 Grok 的 API 密钥并点“测试连接”保存时，由浏览器询问是否允许访问对应地址；用户拒绝则不保存密钥，也不会访问该地址。授予后可随时在浏览器的扩展管理里撤销：

| 地址 | 用途 |
|------|-----|
| `https://api.deepseek.com/*` | DeepSeek，可选权限，仅在用户填入自己的 API 密钥并授权后使用 |
| `https://api.x.ai/*` | Grok（xAI），可选权限，仅在用户填入自己的 API 密钥并授权后使用 |

扩展只在用户选用对应引擎时向这些地址发送请求，请求里只有要翻译的文本和翻译所需的参数（例如目标语言、用户自己的 API 密钥）。

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
