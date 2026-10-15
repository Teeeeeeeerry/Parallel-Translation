/**
 * 免 key 引擎的真实端点冒烟（#1022）。
 *
 * 端到端里引擎端点一律走替身，Bing 的取令牌端点 404 了多久没人知道（#1021）。
 * 这里从外面对每个免 key 引擎的真实端点各发一次最小请求，只在定时与手动
 * 触发时跑，不进 PR 门禁 —— 依赖外部网络的检查一旦进门禁，红灯就没人看了。
 *
 * 判定口径：
 * - 真失败（红）：404、410 等其余 4xx、DNS 解析不了或连不上、200 但响应结构
 *   对不上（鉴权流程或返回格式变了）。
 * - 记一笔就过（不红）：429、408、5xx、超时 —— 被限流或对方一时不稳，不等于
 *   端点没了。CI 的出口 IP 尤其容易吃 429。
 *
 * 不改引擎模块：请求在这里按引擎现在的发法自己拼，端点地址与引擎里的一致由
 * 单元测试对照（check-engines.test.ts）。
 */

export type Verdict = 'ok' | 'soft' | 'fail';

export interface ProbeResult {
  engine: string;
  step: string;
  verdict: Verdict;
  /** HTTP 状态码；网络层失败时为 null */
  status: number | null;
  detail: string;
}

export interface EngineProbe {
  engine: string;
  /** 这一步叫什么，失败信息里点名用（“翻译请求”等） */
  step: string;
  url: string;
  init?: RequestInit;
  /** 200 时校验响应结构：返回 null 表示对得上，否则返回哪里对不上 */
  checkBody: (body: unknown) => string | null;
}

export const GOOGLE_WEB_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
export const BING_EDGE_ENDPOINT = 'https://edge.microsoft.com/translate/translatetext';

export const PROBES: readonly EngineProbe[] = [
  {
    engine: 'google-web',
    step: '翻译请求',
    url: `${GOOGLE_WEB_ENDPOINT}?${new URLSearchParams({
      client: 'gtx', sl: 'en', tl: 'zh-CN', dt: 't', strip: '1', nonced: '1', q: 'Hello world',
    })}`,
    checkBody: (b) =>
      Array.isArray(b) && Array.isArray(b[0]) && typeof (b[0] as unknown[][])[0]?.[0] === 'string'
        ? null
        : '响应不是 [[["译文", …], …], …] 的分句数组',
  },
  {
    engine: 'bing-edge',
    step: '翻译请求',
    url: `${BING_EDGE_ENDPOINT}?${new URLSearchParams({ from: 'en', to: 'zh-Hans', isEnterpriseClient: 'false' })}`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(['Hello world']),
    },
    checkBody: (b) =>
      Array.isArray(b) && typeof (b[0] as { translations?: { text?: unknown }[] })?.translations?.[0]?.text === 'string'
        ? null
        : '响应不是 [{ translations: [{ text }] }] 的数组',
  },
];

/** 状态码 → 判定。2xx 之外：429、408、5xx 记一笔就过，其余 4xx 判失败。 */
export function verdictForStatus(status: number): Verdict {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 429 || status === 408 || status >= 500) return 'soft';
  return 'fail';
}

const TIMEOUT_MS = 20_000;

export async function probe(p: EngineProbe, fetchImpl: typeof fetch = fetch): Promise<ProbeResult> {
  const base = { engine: p.engine, step: p.step };
  let resp: Response;
  try {
    resp = await fetchImpl(p.url, { ...p.init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return { ...base, verdict: 'soft', status: null, detail: `${TIMEOUT_MS}ms 内没有响应` };
    }
    // DNS 解析不了、连接被拒：端点或主机没了
    const code = err.cause?.code ?? err.name;
    return { ...base, verdict: 'fail', status: null, detail: `网络层失败 ${code}: ${err.message}` };
  }
  const verdict = verdictForStatus(resp.status);
  if (verdict !== 'ok') {
    const text = (await resp.text().catch(() => '')).slice(0, 160).replace(/\s+/g, ' ');
    return { ...base, verdict, status: resp.status, detail: text };
  }
  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    return { ...base, verdict: 'fail', status: resp.status, detail: '200 但响应不是 JSON' };
  }
  const mismatch = p.checkBody(body);
  return mismatch
    ? { ...base, verdict: 'fail', status: resp.status, detail: `200 但结构对不上：${mismatch}` }
    : { ...base, verdict: 'ok', status: resp.status, detail: '' };
}

export function formatResult(r: ProbeResult): string {
  const tag = { ok: '通过', soft: '记录（不判失败）', fail: '失败' }[r.verdict];
  const status = r.status === null ? '无状态码' : `HTTP ${r.status}`;
  return `${r.engine} · ${r.step} · ${status} · ${tag}${r.detail ? ` · ${r.detail}` : ''}`;
}

/** --url engine=地址：把某个引擎的探测地址换掉，用来验证检查本身会红（#1022 验收） */
function overrides(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--url') continue;
    const [engine, ...rest] = (argv[++i] ?? '').split('=');
    out.set(engine!, rest.join('='));
  }
  return out;
}

async function main(): Promise<void> {
  const over = overrides(process.argv.slice(2));
  const probes = PROBES.map((p) => (over.has(p.engine) ? { ...p, url: over.get(p.engine)! } : p));
  const results = await Promise.all(probes.map((p) => probe(p)));
  const gh = !!process.env.GITHUB_ACTIONS;
  for (const r of results) {
    const line = formatResult(r);
    console.log(`[check-engines] ${line}`);
    if (gh && r.verdict === 'fail') console.log(`::error title=${r.engine} ${r.step}::${line}`);
    if (gh && r.verdict === 'soft') console.log(`::warning title=${r.engine} ${r.step}::${line}`);
  }
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(
      summary,
      ['## 免 key 引擎真实端点', '', '| 引擎 | 步骤 | 状态码 | 判定 | 说明 |', '|---|---|---|---|---|',
        ...results.map((r) => `| ${r.engine} | ${r.step} | ${r.status ?? '无'} | ${{ ok: '通过', soft: '记录', fail: '失败' }[r.verdict]} | ${r.detail.replace(/\|/g, '\\|')} |`),
        ''].join('\n'),
    );
  }
  const failed = results.filter((r) => r.verdict === 'fail');
  if (failed.length) {
    console.error(`\n[check-engines] ${failed.length} 个免 key 引擎的真实端点不可用：${failed.map((r) => r.engine).join('、')}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
