// Phase 9 — 取文本前的空白归一化（纯函数，无 DOM 依赖）。
//
// Markdown 段落内的软换行会原样保留为文本节点里的 \n（GitHub README 等
// 源文件硬换行的页面最典型）。直接把 \n 送进引擎有两个后果：
// - Google 引擎在 \n 处切句，跨换行的词组被拆开各自翻译（"atomic
//   replacement" → "原子" + "替换"），join 后 \n 原样保留进 DOM，
//   HTML 空白折叠渲染成多余空格
// - OpenAI 引擎用换行分隔编号条目，文本自带的 \n 会把编号结构撑破，
//   续行无编号，LLM 重编号后 parseNumbered 回填错位
//
// 统一在取文本处折叠空白：\s+ → 单个空格，再 trim 首尾。
export function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
