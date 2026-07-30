# 阶段 2 DoD 验收报告 #5（复测）

| 项目 | 内容 |
|---|---|
| 被测阶段 | 阶段 2 — 翻译引擎与最短闭环 |
| 验收依据 | `docs/phases/phase-2-engines.md` |
| 被测提交 | `412492f` fix: DoDR-4 三项修复（分支 `v0.3-engines`） |
| 前四轮 | [DoDR-1](DoDR-1.md)、[DoDR-2](DoDR-2.md)、[DoDR-3](DoDR-3.md)、[DoDR-4](DoDR-4.md) |
| 验收日期 | 2026-07-30 |
| 环境 | Node 24.14.0 / WXT 0.19.29 / TypeScript 5.9.3 |
| 验收方式 | `pnpm typecheck` + `pnpm build` + 构建产物审计 + Node 桩测试（**在本提交上跑不完，见 P2-16**）+ 真实 DOM 回归 |
| **结论** | **未通过** — 上轮 3 项修复方向全对，但 `createGate.setMax()` 是死循环：翻译过一次之后，**任何一次设置变更都会把背景页卡死在 100% CPU**。DoD 3 的验证步骤正好会踩中 |

---

## 1. 上轮问题复测

| 编号 | 上轮问题 | 本轮 |
|---|---|---|
| P2-14 | 状态码没人消费 | ✅ popup 读 `resp.status`，`disabled` / `no-elements` 各有提示；`pt-pop` 关键帧在 `tokens.css`，`popup.css` 有 `@import`，产物中存在 |
| P2-15 | 闸门重建导致并发翻倍 | ⚠️ 设计对了（改上限而非换对象），但实现是死循环（P2-16）；用修正版覆盖后该场景转绿 |
| 逗号运算符 | `doRestore()` 同步抛错逃出 `.catch` | ✅ 已改为 `Promise.resolve().then(() => doRestore())` |

---

## 2. P2-16 `setMax()` 死循环，设置变更即卡死背景页（P0）

`src/queue/concurrency.ts:23`：

```typescript
run.setMax = (n: number) => {
  max = n;
  while (active < max) waiting.shift()?.();   // ← 循环条件与循环体无关
};
```

`waiting.shift()?.()` 只是 resolve 一个 Promise，等待者要到**微任务队列**才继续执行、才会 `active++`。而这是个同步 `while`，微任务在它跑完之前一步也执行不了。于是：

- 队列空时，`shift()` 返回 `undefined`，`?.()` 什么也不做，`active` 永远不变 → 无限空转；
- 队列非空时，先把等待者全部排干，`active` 依旧没变 → 继续无限空转。

**唯一会返回的情况是调用时 `active >= n`**（收缩上限且当前正忙）。实测：

| 场景 | 调用 | 结果 |
|---|---|---|
| 空闲闸门（`active=0`，无等待者） | `setMax(4)` | ❌ 不返回，进程 98.7% CPU |
| 忙碌收缩（`active=6`） | `setMax(2)` | ✅ 立即返回（`6 >= 2`，循环条件一进来就是假） |
| 忙碌放宽（`active=2`，等待 3） | `setMax(4)` | ❌ 不返回 |

构建产物里也是同一形态：

```js
o.setMax = m => { var g; for (e = m; t < e;) (g = n.shift()) == null || g() }
```

**真实触发路径**：`google-web.ts:50` 把 `setMax` 挂在了 `onSettingsChanged` 上。

```
用户翻译一次        → getGate() 创建闸门（gate 不再是 null）
用户改任意设置      → storage.sync.set → onChanged
                    → gate.setMax(maxConcurrency) → 背景页 SW 死循环
```

此后 SW 忙等，`onMessage` 再也不会被处理——翻译、还原、错误提示全部失效，且没有任何报错，表现为"点了没反应"。DoD 第 3 条的验证步骤（先翻译 → 改引擎优先级 → 再翻译）正好是这个顺序。注意翻译之前改设置不会触发：那时 `gate` 还是 `null`，走的是 `else` 分支新建闸门。

桩测在本提交上从 T1 之后就卡住（`patchSettings` → `onChanged` → `setMax`），整套用例跑不完。

### 修法

`while` 的退出条件必须由循环体推进。把 `active++` 放到"放行"这一刻同步执行，`setMax` 与任务完成共用同一个泵：

```typescript
export function createGate(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];

  const pump = () => {
    while (active < max && waiting.length > 0) {
      active++;                 // ← 同步自增，循环必然收敛
      waiting.shift()!();
    }
  };

  function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        task().then(resolve, reject).finally(() => { active--; pump(); });
      });
      pump();
    });
  }

  run.setMax = (n: number) => { max = n; pump(); };
  return run;
}
```

`waiting.length > 0` 这个条件是关键——它保证队列排空后循环一定终止。

把这版覆盖进测试台后，34 条断言 ×2 组参数**全部通过**，其中包括 P2-15 想解决的那条：

```
T12.2 翻译途中改设置后再发起调用，总并发 ≤6   → ✅（上轮实测 12）
```

也就是说 P2-15 的思路是对的，只差这个循环写法。

---

## 3. 结果总览

| # | DoD 项 | #4 | #5 |
|---|---|---|---|
| 1 | popup 点「翻译本页」，段落下方出现译文 | ✅ | ⚠️ 首次可用；改过设置之后失效（P2-16） |
| 2 | 再次点击，译文消失（还原原文） | ✅ | ⚠️ 同上 |
| 3 | 优先级设为 `['bing-edge','google-web']` 后走 Bing | ✅ | ❌ 验证步骤本身会触发 P2-16 |
| 4 | 屏蔽 Google 后自动切 Bing | ✅ | ⚠️ 逻辑未动，但设置变更后整个 SW 已卡死 |
| 5 | 两引擎均不可用时给出可读错误 | ✅ | ⚠️ 同上 |
| 6 | 二次翻译命中缓存，无新请求 | ✅ | ⚠️ 同上 |
| 7 | 并发不超过 6 | ✅ | ⚠️ 同上 |
| 8 | 无 `host_permissions` | ✅ | ✅ |
| — | `typecheck` / `build` | ✅ | ✅（死循环是运行期问题，静态检查看不出来） |

第 1、2、4–7 项标 ⚠️ 而非 ✅：这些逻辑本轮没有改动，在修正 `setMax` 的覆盖版下全部复现通过（§4.2）；但在本提交上，只要用户改过一次设置，它们都会随 SW 一起停摆。

---

## 4. 验证明细

### 4.1 静态与产物

```
pnpm typecheck                                          → 0 error
pnpm build                                              → 48.05 kB
grep host_permissions .output/chrome-mv3/manifest.json  → 无（DoD 8 ✅）
popup 产物含 @keyframes pt-pop                           → 是（提示条动画可用）
background.js：setMax 为 for(e=m;t<e;)… 空转循环          → P2-16
```

### 4.2 桩测试

| 运行方式 | 结果 |
|---|---|
| 本提交源码 | T1 之后卡死（`patchSettings` → `onChanged` → `setMax`），98.7% CPU，用例跑不完 |
| 仅将 `concurrency.ts` 换成 §2 修正版 | **34 / 34 通过，`GATE_MAX=6` 与 `GATE_MAX=2` 两组一致** |

覆盖版下的关键断言（其余同 DoDR-4）：

| 编号 | 断言 | 结果 |
|---|---|---|
| T0 / T11 | 首次按设置建闸门；建好后改 `maxConcurrency` 双向即时生效 | ✅ |
| T2–T7 | 顺序对应、故障切换、JWT 复用与 401、缓存命中与部分命中回填、全失败聚合错误 | ✅ |
| T8 / T9 | `route()` 尊重入参语言对；未注册引擎报错且不发请求 | ✅ |
| T10 | 两次并行 `route()` 总并发恰为 6，两批各自保序 | ✅ |
| **T12.2** | 翻译途中改设置后再发起调用，总并发仍 ≤6 | ✅ **P2-15 目标达成** |

### 4.3 真实 DOM（`en.wikipedia.org/wiki/Translation`）

本轮未改 `collect.ts` / `inject.ts`，回归确认无漂移：

| 观察项 | 结果 |
|---|---|
| 采集元素数 / 正文段落 | 397 / 173 |
| 文章标题 `<h1>` 被采集 | ✅ |
| 不可见元素 / 参考文献条目 | 0 / 0 |
| 注入后原文链接保留 | 11 / 11 |
| 还原后 `innerHTML` 与注入前一致 | ✅ |
| 译文含 `<img onerror>` 时生成元素 | 0，无 XSS 触发 |
| 重新采集跳过已翻译容器 | ✅ |

### 4.4 未覆盖

扩展装入浏览器的端到端链路本环境仍无法执行。**P2-16 是运行期死循环，`typecheck`/`build` 都拦不住**——这类问题只能靠跑起来才暴露，也是本轮唯一靠"把用例真的跑一遍"才发现的缺陷。

---

## 5. 修完后的复测清单

1. **P2-16 回归（必测）**：`node` 里 `const g = createGate(2); g.setMax(4);` 必须立即返回（空闲闸门）。
2. **真机**：翻译一次 → popup 改引擎为 Bing → 再翻译 → 正常走 Bing，SW 不卡死（`chrome://serviceworker-internals` 里 CPU 不飙、状态仍为 activated）。
3. **DoD 3**：改引擎后 Network 只见 `api-edge.cognitive.microsofttranslator.com`。
4. **DoD 7**：整页 397 段翻译，Waterfall 同时 pending ≤6；翻译途中改 `maxConcurrency` 不越限。
5. **P2-14 目视**：关掉总开关点「翻译本页」，popup 底部出现「总开关已关闭」提示。
