// Phase 9 — 取文本前的空白归一化（纯函数，无 DOM 依赖）。
//
// Markdown 段落内的软换行会原样保留为文本节点里的 \n（GitHub README 等
// 源文件硬换行的页面最典型）。直接把 \n 送进引擎有两个后果：
// - Google 引擎在 \n 处切句，跨换行的词组被拆开各自翻译（"atomic
//   replacement" → “原子” + “替换”），join 后 \n 原样保留进 DOM，
//   HTML 空白折叠渲染成多余空格
// - OpenAI 引擎用换行分隔编号条目，文本自带的 \n 会把编号结构撑破，
//   续行无编号，LLM 重编号后 parseNumbered 回填错位
//
// 统一在取文本处折叠空白：\s+ → 单个空格，再 trim 首尾。
export function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * pre 上下文（.pt-chunk / 纯文本 pre）的归一化：折叠行内空白但保留
 * 硬换行。列表逐行条目（RST 的 * item）是文档结构，normalizeText
 * 会把整个列表折叠成一行 —— 引擎收到无结构文本，译文也回不来行结构。
 * 逐行折叠后引擎按行切句，恰好是列表翻译期望的行为。
 */
export function normalizePreText(s: string): string {
  return s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .trim();
}
