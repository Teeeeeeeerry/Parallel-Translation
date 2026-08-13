# 深度测试方案：Parallel-Translation

## Context

Parallel-Translation 是一个对照式网页翻译浏览器扩展（WXT + TypeScript，Manifest V3），9 个阶段开发已完成并通过验收。项目已有 `docs/TESTING.md` 描述测试策略框架（分层金字塔、fixture 页面、CI 编排），但**实际测试代码零行**。

本方案在 TESTING.md 的策略骨架上补充**具体可执行的测试用例**，聚焦三个维度：
1. **风险驱动的优先级排序** — 不按模块平均分配，高风险模块深测
2. **可机械执行的测试用例** — 不用"测试 walker"这种模糊描述，写清输入/操作/断言
3. **组合爆炸的系统性裁剪** — 6 入口 × 3 模式 × 5 引擎 × N 站点不可全排，用正交表/pairwise 覆盖关键组合

## 一、风险分级与测试深度

### 风险矩阵（影响 × 失效概率）

| 风险等级 | 条件 | 模块 |
|---------|------|------|
| 🔴 致命 | 静默错位 / 数据丢失 / 页面崩溃 | router 槽位映射、parseNumbered、render/unrender 幂等、缓存 index 并发、占位符回填 |
| 🟠 高危 | 用户可见错误 / 翻译漏段 / 引擎不可用 | walker shadow 穿透、observer 去重、引擎故障切换、预切分、closestUnit 降级 |
| 🟡 中危 | 体验降级 / 特定站点不可用 | compat 域名补丁、悬浮球定位、段落按钮可点性、快捷键平台映射 |
| 🟢 低危 | 边缘场景 / 仅影响极少数用户 | i18n 漏配 key、样式预设极端情况、popup/options UI |

### 每个模块的测试深度

| 模块 | 单元测试 | 集成测试 | E2E | 理由 |
|------|:---:|:---:|:---:|------|
| `engines/router` | ★★★ | ★★☆ | ★☆☆ | 槽位映射错位=全部段落挂错，必须穷举异常路径 |
| `engines/openai` parseNumbered | ★★★ | ★☆☆ | ☆☆☆ | 纯函数，全状态空间可穷举 |
| `engines/google-web/bing-edge/deepl/gemini` | ★★☆ | ★★☆ | ★★☆ | 格式解析单测，真实接口 E2E |
| `dom/classify` | ★★★ | ★★☆ | ★☆☆ | 判定逻辑穷举，边界清晰 |
| `dom/text` | ★★★ | ★★☆ | ★☆☆ | 占位符机制穷举，安全降级路径必须全覆盖 |
| `dom/walker` | ★★☆ | ★★☆ | ★★★ | shadow DOM 穿透只能 E2E 真实验证 |
| `dom/renderer` | ★★☆ | ★★★ | ★★☆ | DOM 结构断言单测 + E2E 视觉 |
| `dom/observer` | ★☆☆ | ★★☆ | ★★★ | 时序/去重只能 E2E 验证 |
| `dom/pre-split` | ★★★ | ★☆☆ | ★★☆ | 纯文本操作，边界清晰 |
| `dom/normalize` | ★★★ | ☆☆☆ | ☆☆☆ | 纯函数，一行 |
| `dom/compat` | ★★☆ | ☆☆☆ | ★★★ | 域名匹配可单测，真实站点必须 E2E |
| `storage/settings` | ★★★ | ★★☆ | ☆☆☆ | 合并逻辑穷举 |
| `storage/cache` | ★★★ | ★☆☆ | ☆☆☆ | 并发 safety 穷举 |
| `storage/keys` | ★★☆ | ☆☆☆ | ☆☆☆ | local/sync 隔离单测 |
| `queue/concurrency` | ★★★ | ☆☆☆ | ★☆☆ | 纯状态机，穷举 |
| `hotkeys/normalize` | ★★★ | ☆☆☆ | ★★☆ | 平台映射穷举 |
| `hotkeys/platform` | ★★☆ | ☆☆☆ | ★★☆ | Mac 分支需 macOS runner |
| `ui/*` | ★☆☆ | ★☆☆ | ★★★ | 交互=E2E 专属（jsdom 判不了"点得到"） |
| `styles/custom` | ★★★ | ☆☆☆ | ★☆☆ | 注入规则=产物断言 |
| `i18n` | ★★☆ | ☆☆☆ | ☆☆☆ | key 覆盖率检查 |

## 二、单元测试用例目录

### 2.1 `engines/openai.ts` — `parseNumbered`

```typescript
// 风险：输出长度 ≠ 输入长度 = 译文批量错位，比漏翻严重 100 倍

describe('parseNumbered', () => {
  // 基础：三种编号格式
  test('1. / 1、/ 1) 三种格式均能解析')
  test('混合编号格式（同一响应混用 1. 和 2、）仍正确提取')
  test('编号后有空格的容错：'1.  Hello' → 'Hello'')

  // 长度不变性（最重要的一组）
  test('输出长度恒等于 expected 参数')
  test('expected=0 返回空数组')
  test('expected=100 返回长度 100（性能：毫秒级）')

  // 漏行与多行
  test('缺行：输入 1/3/5，expected=5 → 缺的行填空串，不错位')
  test('多行：输入 1-6，expected=3 → 只取前 3，多余的被忽略')
  test('编号乱序：输入 3/1/2 → 输出按 expected 索引对齐')

  // 边界
  test('空字符串输入 → expected 长度的空串数组')
  test('正文包含 "1." 样式的编号列表 → 只有行首编号被当成分隔符')
  test('编号超过 expected 的行被忽略')
  test('编号为 0 或负数的行视为正文')
  test('单行不含编号 → 输出 [空串]（expected=1）')
})
```

### 2.2 `engines/router.ts` — 路由与故障切换

```typescript
describe('route', () => {
  // mock 所有引擎 + storage

  test('按 enginePriority 顺序尝试引擎')
  test('第一个引擎成功 → 不调第二个')
  test('引擎不支持目标语言 → 跳过')
  test('retryable=true 失败 → 切下一个引擎')
  test('retryable=false 失败 → 立即抛，不尝试后续')
  test('全部引擎失败 → 错误消息列出所有失败原因')
  test('部分失败(failedIndices)→ 失败槽位留给下一个引擎重试')
  test('部分失败 → 成功条目写缓存，失败条目不写')
  test('useCache=false → 跳过缓存查询')
  test('缓存全部命中 → 不调引擎，直接返回')
  test('缓存部分命中 → 只请求未命中条目')
  test('缓存 key 前缀与引擎 id 对应 → 避免跨引擎误命中')
})
```

### 2.3 `dom/text.ts` — 文本提取与占位符

```typescript
describe('translatableTextEx', () => {
  test('纯文本元素 → 返回 textContent，preserves 为空 Map')
  test('.notranslate 子树被跳过')
  test('shouldOmitText 命中的元素被跳过')

  // #58 占位符
  test('单个 preserve 元素 → 文本含 ⟦PT0⟧，preserves 有一对映射')
  test('多个 preserve 元素 → ⟦PT0⟧ ⟦PT1⟧ 递增')
  test('preserve 在 notranslate 内部 → 整体跳过（没有占位符）')
  test('嵌套 preserve → 只取最外层匹配')

  // 元素间空格
  test('相邻元素间自动补空格 → "HelloWorld" 变 "Hello World"')
})

describe('shallowTranslatableTextEx', () => {
  test('只提取直接文本 + 内联子元素，块级子元素被跳过')
  test('<li>标签文字<ul><li>子条目</li></ul></li> → 只提取"标签文字"')
  test('内联子元素的 preserve 仍生效')
  test('纯文本无块级子元素 → 与 translatableTextEx 结果一致')
})

describe('restorePreserves', () => {
  test('空 preserves → 返回原译文')
  test('⟦PT0⟧ → 用户名 → 正确替换')
  test('占位符数量不匹配 → 降级，返回不含占位符的原文')
  test('占位符序号不匹配 → 降级')
  test('引擎破坏了占位符格式 → 降级')
  test('降级结果不含任何 ⟦PT 残留')
  test('多个占位符 → 全部正确替换')
})

describe('hasBlockTextChildren', () => {
  test('含块级子元素且有文本 → true')
  test('只有内联子元素 → false')
  test('块级子元素但 textContent 全空 → false')
})
```

### 2.4 `dom/classify.ts` — 元素分类

```typescript
describe('isTranslationUnit', () => {
  // DIRECT_SET
  test('<p>Hello</p> → true')
  test('<h1>Title</h1> → true')
  test('<li>Item</li> → true')

  // CONTAINER_SET
  test('<div>直接文本</div> → true')
  test('<div><p>嵌套</p></div>（无直接文本） → false')
  test('<section>直接文本</section> → true')

  // 混合内容 #23
  test('<div>直接文本<p>块级子元素</p></div> → true（hasDirect=true）')
  test('<li>标签<ul><li>子</li></ul></li> → true（hasDirect=true）')

  // 非翻译单元
  test('<span>inline</span> → false')
  test('<a>link</a> → false')
  test('含非内联带文本子元素且无直接文本 → false')
  test('data-pt-chunk="1" 的 span → true（预切分）')

  // 边界
  test('空元素 → false')
  test('只有空白文本 → false')
})

describe('hasNonTextContent', () => {
  test('含 img → true')
  test('含 button → true')
  test('含 iframe → true')
  test('行内装饰图片（全在 INLINE_SET 祖先链内）→ false（#55）')
  test('favicon 角标不阻断 → false')
  test('深层嵌套的非文本内容 → true')
  test('空元素 → false')
})

describe('closestUnit', () => {
  test('span → 向上找到 p → 返回 p')
  test('已经是翻译单元 → 返回自身')
  test('含非文本内容 → 向下降级到纯文本后代（#50）')
  test('无纯文本后代 → 继续向上找')
  test('根元素无匹配 → null')
  test('shouldSkip 命中 → 不返回（继续向上）')
})

describe('shouldSkipNonVisual', () => {
  test('SKIP_SET 标签 → true')
  test('代码块 pre → true')
  test('.notranslate → true')
  test('contentEditable → true')
  test('已在 data-pt="done" 内 → true')
  test('PT UI 内 → true')
  test('导航/页脚/侧栏 → true')
  test('文本 < 3 字符 → true')
  test('文本 > 3072 字符 → true')
  test('outerHTML > 4096 → true')
  test('纯数字/日期/价格 → true')
  test('正常段落 → false')
})

describe('isMainlyNumeric', () => {
  test('"123" → true')
  test('"1.2k" → true')
  test('"2026-07-30" → true')
  test('"$99.99" → true')
  test('"Hello 123" → false')
  test('超过 30 字符 → false（不管内容）')
})
```

### 2.5 `dom/pre-split.ts` — 预切分

```typescript
describe('splitPre', () => {
  test('短 pre（< MAX_TEXT）→ 返回 null，不修改 DOM')
  test('代码块 pre → 返回 null')
  test('含子元素的 pre → 返回 null')
  test('已切分的 pre → 返回 null（幂等）')
  test('在 data-pt="done" 内的 pre → 返回 null')

  test('超长纯文本 pre → 按空行切分为 .pt-chunk span')
  test('装饰行（==== -----）不成为 chunk，保留为裸文本')
  test('单个超长块（> MAX_TEXT 且无空行）→ 不切，保持裸文本')
  test('切分后 pre 文本逐字节不变')
  test('返回的 span 数组长度 = 可翻译块数')
})

describe('unsplitPre', () => {
  test('把 .pt-chunk 文本放回 pre 并移除 span')
  test('移除 data-pt-split 属性')
  test('无 chunk 的 pre → 无操作')
})
```

### 2.6 `dom/normalize.ts`

```typescript
describe('normalizeText', () => {
  test('\\s+ → 单个空格')
  test('\\n → 空格')
  test('\\t → 空格')
  test('连续空格 → 单个空格')
  test('首尾空白 → trim')
  test('空字符串 → ""')
  test('正常文本不变')
  test('中文间空白 → 保留单空格（不吞掉有意义的分隔）')
})
```

### 2.7 `storage/settings.ts` — 设置合并

```typescript
describe('merge / patchSettings', () => {
  test('空存储 → 全量默认值')
  test('部分覆盖 → 其余保持默认')
  test('hotkeys 部分覆盖 → 兄弟键不丢失')
  test('siteList 部分覆盖 → mode 和 list 独立合并')
  test('models 部分覆盖 → 引擎 key 独立合并')
  test('patchSettings 传 {} → 不改变任何值')
  test('连续两次 patchSettings → 第二次基于第一次的结果')
})

describe('onSettingsChanged', () => {
  test('设置变更 → 回调触发')
  test('无关 key 变更 → 回调不触发')
  test('变更来自其他上下文 → 内存副本更新')
  test('退订 → 回调不再触发')
})
```

### 2.8 `storage/cache.ts` — 缓存

```typescript
describe('cacheGet / cacheSet', () => {
  test('写入后读取 → 命中')
  test('未写入 → 返回 null')
  test('相同文本 → 相同 key（SHA-1 稳定性）')
  test('不同引擎 → 不同 key 前缀')
  test('from/to 参与 key → 语言对变化不误命中')
})

describe('LRU 淘汰', () => {
  test('超过 MAX_ENTRIES → 最旧条目被淘汰')
  test('命中刷新 LRU 位置 → 热条目不被淘汰')
  test('淘汰时同时删除 storage 中的值和 index 引用')
  test('无孤儿条目：被淘汰的 key 在 storage 中不存在')
})

describe('并发安全', () => {
  test('并发 cacheSet × 10 → index 条目数 = 10')
  test('并发 cacheGet × 10 + cacheSet × 10 → index 不丢条目')
  test('cacheGet 和 cacheClear 并发 → 不产生异常状态')
})
```

### 2.9 `queue/concurrency.ts` — 并发闸门

```typescript
describe('Gate', () => {
  test('任务数 ≤ max → 全部并发执行')
  test('任务数 > max → 同时运行 ≤ max')
  test('任务完成 → 等待队列自动推进')
  test('setMax 调大 → 队列立即释放')
  test('setMax 调小 → 不影响已运行的')
  test('任务抛异常 → 仍释放槽位（finally）')
  test('active 计数全程正确')
})
```

### 2.10 `hotkeys/normalize.ts`

```typescript
describe('fromEvent', () => {
  // Mac
  test('Mac Meta+Y → "Mod+Y"')
  test('Mac Ctrl+Shift+T → "Ctrl+Shift+T"')
  test('Mac Meta+Alt+Shift+D → "Mod+Alt+Shift+D"')

  // Windows/Linux
  test('Win Ctrl+Y → "Mod+Y"')
  test('Win Ctrl+Shift+Y → "Mod+Shift+Y"')

  // 拒绝
  test('无修饰键 → null')
  test('修饰键自身 → null（Control/Meta/Alt/Shift 单独按下）')
})

describe('isTypingContext', () => {
  test('input → true')
  test('textarea → true')
  test('[contentEditable] → true')
  test('普通 div → false')
  test('body → false')
})
```

### 2.11 `styles/custom.ts`

```typescript
describe('validateCustomCss', () => {
  test('合法声明块 → ok')
  test('含花括号 → 拒绝')
  test('含 @import → 拒绝')
  test('含 <style> → 拒绝')
  test('含 javascript: → 拒绝')
  test('含 expression() → 拒绝')
  test('空字符串 → ok')
})

describe('applyCustomCss', () => {
  test('合法输入 → 注入 <style> 到 <head>，内容被 .pt-trans {} 包裹')
  test('非法输入 → 不注入')
  test('再次调用 → 先移除旧 <style> 再注入新的')
  test('注入的 style 标记 data-pt-ui="1" → walker 跳过')
})
```

### 2.12 `storage/keys.ts`

```typescript
describe('keys', () => {
  test('setKey → getKey 可读回')
  test('removeKey → getKey 返回 undefined')
  test('不同引擎的 key 互不干扰')
  test('key 存在 local 不在 sync')
  test('getKey 未设置引擎 → undefined')
})
```

### 2.13 `dom/compat.ts`

```typescript
describe('mainDomain', () => {
  test('github.com → github.com')
  test('news.ycombinator.com → ycombinator.com')
  test('sub.domain.example.com → example.com')
  test('localhost → localhost')
})

describe('isGenericInlineBadge', () => {
  test('" +3" 结尾的 span → true')
  test('"+12" 结尾的 a → true')
  test('role=button + favicon 尺寸 img → true')
  test('普通内联文本 → false')
  test('超过 40 字符 → false')
  test('空文本 → false')
  test('非内联元素 → false')
})

describe('shouldPreserveText', () => {
  test('github.com: a.user-mention → 返回用户名文本')
  test('github.com: [data-hovercard-url^="/users/"] → 返回文本')
  test('github.com: 普通链接 → null')
  test('非 github.com → null')
  test('非内联元素 → null')
})
```

### 2.14 `dom/renderer.ts`

```typescript
describe('render', () => {
  test('创建 .pt-origin + .pt-trans 子元素')
  test('原文子节点搬入 .pt-origin（while+appendChild，非 innerHTML）')
  test('译文设到 .pt-trans.textContent')
  test('元素标记 data-pt="done"')
  test('元素标记 data-pt-src="page" 或 "para"')
  test('pre 内译文自动加 .pt-pre 类（#66）')
  test('含非文本内容 → 返回 false（纵深防御）')
  test('已标记 done → 返回 true（幂等，不二次渲染）')
})

describe('unrender', () => {
  test('把 .pt-origin 子节点放回元素')
  test('移除 .pt-origin 和 .pt-trans')
  test('移除 data-pt 和 data-pt-src 属性')
  test('无 .pt-origin → 无操作')
})

describe('applyMode', () => {
  test('bilingual → html 上无 pt-only-trans-page 类')
  test('translation-only → html 上有 pt-only-trans-page 类')
  test('paraMode=follow → 跟随 pageMode')
  test('paraMode 独立值 → 独立生效')
})

describe('applyStyle', () => {
  test('替换 pt-style-* 类名')
  test('不会残留旧样式类')
})
```

### 2.15 `runtime/messaging.ts` — content → background 消息通道健壮性（#89）

测试文件：unit/runtime/messaging.test.ts

```typescript
// #89：MV3 headless 下 SW 未就绪时 pt:translate 被丢弃。
// 契约：ping 预热 + 传输层重试；引擎级失败不重试；永不抛出。

describe('translateViaBackground — SW 就绪时', () => {
  test('ping 一次 + translate 一次，直接返回译文')
})

describe('translateViaBackground — SW 冷启动（#89 根因）', () => {
  test('ping 前两次无响应，第三次就绪后翻译成功')
  test('translate 首次无响应（SW 在 ping 后失联）→ 自动重试成功')
  test('sendMessage reject（Receiving end does not exist）→ 重试成功')
})

describe('translateViaBackground — 失败语义', () => {
  test('SW 响应 {ok:false}（引擎级失败）→ 原样返回，不重试')
  test('SW 始终无响应：ping 预算耗尽 → {ok:false}，不发送 translate')
  test('translate 持续无响应：重试预算耗尽 → {ok:false}')
})
```

## 三、集成测试用例

集成测试在扩展的真实上下文（chrome.storage、chrome.runtime.sendMessage）中运行，mock 翻译端点的 fetch。

### 3.1 翻译管道端到端（content → background → router → engine）

```
测试文件：src/__tests__/integration/translate-pipeline.test.ts

场景 1：正常整页翻译
  准备：basic.html fixture，mock Google 返回正确译文
  操作：触发 togglePage()
  断言：data-pt="done" 的元素数 = fixture 中可翻段落数
        每个 .pt-trans 的 textContent 非空
        .pt-origin 中的文本是原文

场景 2：整页翻译 + 缓存命中
  准备：先触发一次翻译，再还原
  操作：再次触发翻译
  断言：第二次不产生新 fetch 请求（全部缓存命中）

场景 3：分批发送（15段/批）
  准备：30 段的 fixture
  操作：触发翻译
  断言：产生了 2 批 chrome.runtime.sendMessage 调用
        两批并发发送（不是串行等待）

场景 4：渲染被拒元素
  准备：含非文本内容的 fixture（img + p 混合）
  断言：render 拒绝的元素被计数，toast 出现
        其余正常段落仍被翻译

场景 5：翻译 → 还原 → 翻译幂等
  操作：翻译 → 还原 → 翻译
  断言：第二次翻译后的 DOM 结构 = 第一次翻译后的 DOM 结构

场景 6：toggle 逻辑正确
  准备：页面上已有 data-pt="done"
  操作：调用 togglePage()
  断言：走 doRestore 路径，不是再次翻译

场景 7：禁用扩展后不翻译
  准备：enabled=false
  操作：触发翻译
  断言：返回 'disabled'，不发送请求
```

### 3.2 缓存并发安全

```
场景 1：router 并发调用 → cache 操作序列化
  操作：同时发送 3 个 route() 调用
  断言：cache index 条目数 = 正确值，无孤儿 key

场景 2：cacheClear 与 cacheSet 并发
  操作：一个线程 cacheClear，另一个线程 cacheSet
  断言：完成后状态一致（要么全清要么留一条，无中间态）
```

### 3.3 设置跨上下文同步

```
场景 1：popup 改设置 → content script 收到通知
  操作：在 popup 上下文 patchSettings({ style: 'underline' })
  断言：content script 的 onSettingsChanged 回调被触发
        回调收到的 ns.style === 'underline'

场景 2：settingsReady 缓存复用
  断言：多次调用 settingsReady() → 返回同一个 Promise
        不会重复读 storage
```

## 四、E2E 测试用例

### 4.1 Fixture 页面清单

在 `docs/TESTING.md` 已有的 9 个 fixture 基础上，增加以下：

| # | 文件 | 复刻特征 | 对应 issue |
|---|------|---------|-----------|
| 1 | `basic.html` | p/li/h1-h6 标准结构 | — |
| 2 | `shadow.html` | 三层嵌套 shadowRoot | #54 |
| 3 | `custom-elements.html` | 自定义元素 + slot | #54 |
| 4 | `iframe.html` | 同源 iframe | — |
| 5 | `infinite.html` | 无限滚动追加 | #49 |
| 6 | `spa.html` | history.pushState 切换 | — |
| 7 | `hostile.html` | CSS reset 激进 + 高 z-index | — |
| 8 | `noise.html` | 数字/日期/超长/.notranslate | — |
| 9 | `nested.html` | 混合内容元素 | #23 |
| **10** | **`preserve.html`** | **GitHub 用户名场景：a.user-mention + data-hovercard-url** | **#58** |
| **11** | **`pre-blocks.html`** | **超大纯文本 pre + 代码块 pre 混合** | **#65 #66** |
| **12** | **`rtl.html`** | **RTL 文本 + RTL 段落按钮定位** | — |
| **13** | **`media-mix.html`** | **图片/按钮与文本交错：非文本内容降级** | **#50 #55** |
| **14** | **`entity.html`** | **HTML 实体、零宽字符、Unicode 特殊字符** | — |

### 4.2 组合测试矩阵（正交裁剪）

全组合 = 6 入口 × 3 模式 × 5 引擎 × 14 fixture = 1260。使用 pairwise 降至约 40 个。

**核心 E2E 套件（每次 push 必跑，~25 个）**：

```
入口覆盖（每入口至少 1 个用例在 basic.html + Google 引擎）：
  TC-E2E-01: 悬浮球点击 → 翻译 → 状态变化（idle→loading→done）
  TC-E2E-02: 悬浮球再次点击 → 还原 → 状态变化（done→idle）
  TC-E2E-03: 快捷键 Mod+Shift+Y → 翻译
  TC-E2E-04: 快捷键 Mod+Shift+M → 切换显示模式
  TC-E2E-05: 段落悬停按钮 → 浮出 → 点击翻译 → 按钮变"还原"态
  TC-E2E-06: 段落悬停按钮还原态 → 点击 → 按钮变"翻译"态
  TC-E2E-07: 右键菜单 → 选中文本 → 翻译 toast 显示译文
  TC-E2E-08: 修饰键拖光标 → 翻译选区 → toast 显示译文
  TC-E2E-09: 工具栏 popup → 点击翻译按钮 → 状态上报
  TC-E2E-10: 工具栏 popup → 切换模式下拉

模式覆盖（在 shadow.html + Google 引擎）：
  TC-E2E-11: 对照模式 → 原文和译文同时可见
  TC-E2E-12: 仅译文模式 → 原文隐藏（display:none）
  TC-E2E-13: 单段翻译仅译文 → 段落按钮翻译后原文隐藏
  TC-E2E-14: paraDisplayMode 独立于 pageMode

引擎覆盖：
  TC-E2E-15: Google 引擎 → 译文正确（basic.html）
  TC-E2E-16: Bing 引擎 → 译文正确（basic.html）
  TC-E2E-17: OpenAI（mock 端点）→ 编号解析正确
  TC-E2E-18: DeepL（mock 端点）→ 语言码映射正确
  TC-E2E-19: Gemini（mock 端点）→ Header auth 正确

DOM 覆盖（每 fixture 至少 1 个用例）：
  TC-E2E-20: shadow.html → 三层 shadow 全部翻译
  TC-E2E-21: nested.html → 无重复翻译（每个原文只出现一次）
  TC-E2E-22: infinite.html → 滚动后新内容被翻译（observer）
  TC-E2E-23: spa.html → 路由切换后新内容被翻译
  TC-E2E-24: hostile.html → 注入 UI 正常显示（CSS 不被覆盖）
  TC-E2E-25: noise.html → 数字/超长段被正确跳过
  TC-E2E-26: preserve.html → 用户名占位符原样保留
  TC-E2E-27: pre-blocks.html → 超大 pre 被切分翻译
  TC-E2E-28: rtl.html → 段落按钮贴在文字左侧
  TC-E2E-29: media-mix.html → 含图片的容器被降级
  TC-E2E-30: iframe.html → 主文档翻译不影响 iframe 内
  TC-E2E-46: infinite.html → mock 丢失后增量翻译自动恢复（#90 回归）
  TC-E2E-47: spa.html → 增量翻译瞬时失败后自动重试（#91 回归）
  TC-E2E-48: basic.html → 多批增量翻译部分失败自动重试（#91 回归）
```

**扩展 E2E 套件（发布前跑，~15 个）**：

```
  TC-E2E-31: 故障切换 → mock Google 500 → 自动切 Bing
  TC-E2E-32: 全引擎失败 → mock 全部 500 → error toast
  TC-E2E-33: 部分失败 → 3/5 段成功 → 成功段渲染、失败段交给下一引擎
  TC-E2E-34: 缓存上限 → 写入 5100 条 → 条目 ≤ 5000
  TC-E2E-35: 翻译-还原 100 次 → 节点数不变（无泄漏）
  TC-E2E-36: 无限滚动 50 轮 → 堆内存不持续增长
  TC-E2E-37: 样式切换 → 新内容保持当前样式
  TC-E2E-38: 自定义 CSS → .pt-trans 包含用户规则
  TC-E2E-39: 禁用扩展 → 零翻译请求
  TC-E2E-40: BYOK key 无效 → 直接报错，不故障切换
  TC-E2E-41: 响应条目数不足 → 缺失留空，其余不错位
  TC-E2E-42: 翻译中途切换语言 → 旧结果被丢弃
  TC-E2E-43: 悬浮球拖到视口外 → 自动钳制
  TC-E2E-44: 超长段落（5000 字符）→ 被跳过不发送请求
  TC-E2E-45: RTL 页面全文翻译 → 段落按钮 RTL 定位 + 翻译结果正确
```

### 4.3 关键 E2E 用例详细规格

#### TC-E2E-26: 占位符保留验证（#58 回归）

```
Fixture: preserve.html
结构：
  <p>
    <a class="user-mention" data-hovercard-url="/users/testuser">@testuser</a>
     commented on this issue
  </p>
  <p>
    Multiple users:
    <a class="user-mention">@alice</a>,
    <a class="user-mention">@bob</a>, and others
  </p>

操作：
  1. 设置 Google 引擎
  2. 触发全页翻译

断言：
  1. 两段都标记 data-pt="done"
  2. 译文中不含 ⟦PT0⟧ / ⟦PT1⟧（占位符被替换回原文）
  3. 第一段译文包含 "@testuser"（原样保留）
  4. 第二段译文包含 "@alice" 和 "@bob"
  5. 占位符降级不触发（console 中无 "[PT] preserve 降级" 日志）
```

#### TC-E2E-27: pre 切分验证（#65 #66 回归）

```
Fixture: pre-blocks.html
结构：
  <pre class="plain">（7000+ 字符纯文本直接持有，含空行 —— 无子元素且超过 MAX_TEXT，splitPre 才能触发）</pre>
  <pre class="highlight"><code>function hello() { return 1; }</code></pre>

操作：
  1. 触发全页翻译
  2. 检查 DOM

断言（当前 E2E 实现）：
  1. pre.plain 带 data-pt-split="1" 且切出 ≥2 个 .pt-chunk 块，首个块已翻译（切分发生）
  2. .highlight pre 内无 data-pt="done"（代码块跳过）

（文本逐字节不变、.pt-pre 字体、还原恢复等由单元测试
 docs/testing/unit/dom/pre-split.test.ts 覆盖）
```

#### TC-E2E-29: 非文本内容降级验证（#50 #55 回归）

```
Fixture: media-mix.html
结构：
  <div>文本内容 <img src="icon.png" width="16" height="16"> 更多文本</div>
  <div><img src="photo.jpg" width="800" height="600"><p>图片说明</p></div>
  <section><p>纯文本段落</p><button>点击</button></section>

断言：
  1. 第一个 div：行内 favicon 不阻断 → 整段可翻译
  2. 第二个 div：大图阻断 → 不翻译，但内嵌 <p> 被独立翻译
  3. 第三个 section：button 阻断 → section 被降级，内嵌 <p> 独立翻译
  4. 所有 data-pt="done" 元素不含 img/button 子元素（在 .pt-origin 内）
```

### 4.4 真实站点冒烟（手动 + 定时 CI 允许失败）

| 站点 | 关键场景 | 对应功能 |
|------|---------|---------|
| Wikipedia | 标准文章 | 基本翻译 + 对照阅读 |
| GitHub | README/Issue/PR 评论 | #58 用户名保留 + #65 pre 切分 + 代码块跳过 |
| Reddit | 帖子 + 评论（新版 shadow DOM） | shadow 穿透 + 无限滚动 |
| YouTube | 视频描述 + 评论 | 元数据跳过 + 自定义元素 |
| Medium | 文章 + SPA 导航 | SPA 路由 + 懒加载 |

## 五、构建产物断言

不测源码，只测 `.output/` 产物——源码看着对但产物里缺失的 bug 只能用这种方式抓。

```typescript
describe('构建产物校验', () => {
  test('manifest.json 包含 default_locale')
  test('manifest.json 权限 = ["contextMenus", "storage"]（无 host_permissions）')
  test('manifest.json content_scripts matches = ["<all_urls>"]')
  test('manifest.json content_scripts 不含 allFrames: false（必须 true）')
  test('各浏览器产物目录结构一致')
  test('CSS 产物包含六个预设样式规则')
  test('CSS 产物包含 injected.css 的规则')
  test('_locales/ 三语 messages.json 存在且无空值')
  test('icon/ 目录含 16/32/48/128 四种尺寸')
  test('welcome.html 存在并可独立打开')
  test('options.html 存在')
  test('popup.html 存在')
})
```

## 六、专项测试

### 6.1 性能基准

| 指标 | 阈値 | 测量方式 |
|------|------|---------|
| 200 段整页翻译总耗时 | < 30s | Playwright timeline |
| 单段翻译（段落按钮） | < 3s 出现译文 | Playwright timing |
| 翻译-还原循环（×100）DOM 节点数 | 无增长 | 循环后 querySelectorAll('*').length |
| 无限滚动 50 轮堆内存 | < 基线 × 2.5 | CDP HeapProfiler + 强制 GC |
| 缓存 5000 条时的内存 | < 50MB | CDP Performance.getMetrics |
| 首屏翻译（10 段）用户感知延迟 | < 5s | Playwright 计时 |

### 6.2 安全验证

| 项目 | 测试方法 |
|------|---------|
| API key 仅存 local，不在 sync | `chrome.storage.sync.get(null)` 后 JSON.stringify 不含 "sk-" |
| 导出设置不含 key | 导出的 JSON 不含 "pt-keys"、不含 "sk-" |
| 禁用扩展后零请求 | 开启请求拦截，设置 enabled=false，滚动页面，断言请求数=0 |
| 自定义 CSS XSS 阻止 | `<style>`、`@import`、`javascript:`、`expression()` 注入全部被拒绝 |
| 隐私政策中的主机列表 = 代码中实际外发的主机 | 解析 `store/privacy-policy.md` 与 ALLOWED 常量比对 |

### 6.3 i18n 覆盖率

```typescript
describe('i18n', () => {
  test('三个 locale 的 key 集合完全一致（无漏配）')
  test('所有 key 在源码中被引用（无死 key）')
  test('所有 tf() 调用的 fallback 与 zh_CN/messages.json 一致')
  test('data-i18n 属性值都有对应的 messages key')
})
```

## 七、回归测试套件与 CI 触发策略

### 7.1 三级套件

```
Level 1 — 每次 push 必跑（< 30s）:
  ├── pnpm typecheck
  ├── vitest unit（全 mock，~100 个用例）
  └── vitest 产物断言（构建后）

Level 2 — PR 合并前跑（< 5min）:
  ├── Level 1 全部
  ├── E2E 核心套件（~25 个，Google 引擎 + mock 端点）
  └── pnpm build（三种浏览器）

Level 3 — 发布前 / 每周定时（< 30min）:
  ├── Level 2 全部
  ├── E2E 扩展套件（~15 个，含故障切换/性能/泄漏）
  ├── 真实站点冒烟（允许红）
  └── 安全验证套件
```

### 7.2 CI 配置（GitHub Actions）

```yaml
# .github/workflows/test.yml

name: Test

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 9 * * 1'  # 每周一 9am UTC，真实站点冒烟

jobs:
  # Level 1 — 每次 push
  unit-and-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test                # vitest unit
      - run: pnpm build
      - run: pnpm test:artifacts      # 产物断言

  # Level 2 — PR 时
  e2e-core:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    concurrency: { group: e2e, cancel-in-progress: true }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm build
      - run: pnpm test:e2e -- --grep "@core"

  # macOS — 快捷键
  hotkeys-macos:
    if: github.event_name == 'pull_request'
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm build
      - run: pnpm test:e2e -- --grep "@mac"

  # Level 3 — 定时 + 手动
  e2e-full:
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    concurrency: { group: e2e-full, cancel-in-progress: true }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm build
      - run: pnpm test:e2e                # 全部 E2E（含性能/安全）

  smoke-real-sites:
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    continue-on-error: true               # 允许红
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test:e2e -- --grep "@real"
```

## 八、测试基础设施搭建

### 8.1 目录结构

```
__tests__/
├── unit/
│   ├── engines/
│   │   ├── parseNumbered.test.ts
│   │   ├── router.test.ts
│   │   └── engines.test.ts         # google/bing/deepl/gemini 格式解析
│   ├── dom/
│   │   ├── classify.test.ts
│   │   ├── text.test.ts
│   │   ├── pre-split.test.ts
│   │   ├── normalize.test.ts
│   │   └── compat.test.ts
│   ├── storage/
│   │   ├── settings.test.ts
│   │   ├── cache.test.ts
│   │   └── keys.test.ts
│   ├── queue/
│   │   └── concurrency.test.ts
│   ├── hotkeys/
│   │   └── normalize.test.ts
│   ├── styles/
│   │   └── custom.test.ts
│   └── i18n/
│       └── coverage.test.ts
├── integration/
│   ├── translate-pipeline.test.ts
│   ├── cache-safety.test.ts
│   └── settings-sync.test.ts
├── e2e/
│   ├── fixtures/
│   │   ├── basic.html
│   │   ├── shadow.html
│   │   ├── preserve.html            # 新增 #58
│   │   ├── pre-blocks.html          # 新增 #65 #66
│   │   ├── rtl.html                 # 新增
│   │   ├── media-mix.html           # 新增 #50 #55
│   │   ├── entity.html              # 新增
│   │   └── ...
│   ├── fixtures.ts                  # Playwright 夹具
│   ├── core.spec.ts                 # 核心 E2E（TC-E2E-01 ~ 30、46 ~ 48）
│   ├── extended.spec.ts             # 扩展 E2E（TC-E2E-31 ~ 45）
│   ├── perf.spec.ts                 # 性能基准
│   ├── security.spec.ts             # 安全验证
│   └── real-sites.spec.ts           # 真实站点冒烟
└── artifacts/
    └── build-output.test.ts         # 产物断言
```

### 8.2 工具链配置

```bash
pnpm add -D vitest @vitest/coverage-v8 jsdom @playwright/test
```

**vitest.config.ts**：
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['__tests__/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/engines/**', 'src/dom/**', 'src/storage/**', 'src/hotkeys/**', 'src/styles/**', 'src/queue/**'],
      thresholds: {
        'src/engines': { lines: 85 },
        'src/dom': { lines: 85 },
        'src/storage': { lines: 85 },
        'src/hotkeys': { lines: 85 },
        'src/styles': { lines: 85 },
        'src/queue': { lines: 85 },
      },
    },
  },
});
```

**playwright.config.ts**：
```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '__tests__/e2e',
  timeout: 60_000,
  retries: 1,
  use: { headless: true },
});
```

### 8.3 Mock 策略

| 层 | Mock 什么 | 用什么 |
|----|---------|-------|
| 单元 | chrome.storage、chrome.i18n、fetch、crypto.subtle | vitest mock / fake-indexeddb |
| 集成 | fetch（翻译端点） | msw / Playwright route |
| E2E | Google（`mockGoogle` fixture） | SW 内 stub fetch：描述符存 chrome.storage.local + 翻译路由前自愈安装（#90；CDP route 对 SW 请求拦截不可靠，已弃用） |
| E2E | Bing（TC-E2E-16） | SW 内 stub fetch（单测内联注入，同上原因） |
| E2E | BYOK 引擎（全部用例） | Playwright route.fulfill（不消耗真实 API key） |

## 九、测试用例优先级与实施顺序

### 第一优先级（立即实施）：高风险模块的单元测试

1. `parseNumbered`（15 个用例）— 输出错位 = 全部段落挂错
2. `router` 故障切换 + 槽位映射（12 个用例）— 静默错位
3. `text.ts` 占位符机制（15 个用例）— #58 回归保护
4. `cache.ts` 并发安全（8 个用例）— index 丢失 → 缓存泄漏
5. `classify.ts` 判定规则（25 个用例）— 采集漏段/多段

### 第二优先级：核心 E2E 套件

6. Playwright 夹具搭建
7. 6 个入口 × 基础 fixture（10 个用例）
8. DOM 特征 fixture × shadow/嵌套/SPA（10 个用例）
9. 新增 fixture 页面编写（5 个 HTML 文件）+ 对应用例

### 第三优先级：扩展覆盖

10. 故障切换 + 异常路径（8 个用例）
11. 性能基准（6 个用例）
12. 安全验证（5 个用例）
13. 真实站点冒烟

## 十、验证方法

全部测试完成后，通过以下方式确认测试体系有效：

1. **变异测试**：对核心模块（router、text、classify）注入已知 bug，验证至少一个测试失败
2. **覆盖率报告**：`pnpm vitest run --coverage`，确认引擎/DOM/存储模块 ≥ 85%
3. **E2E 报告**：Playwright HTML report → 确认 0 失败
4. **CI 绿灯**：Level 1 + Level 2 全绿后，合并到 main
