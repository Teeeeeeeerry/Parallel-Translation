// Phase 7 — 引擎分区：优先级拖拽排序 + 启用/停用 + BYOK 密钥与模型名 + 测试连接。

import type { EngineId } from '~/src/storage/schema';
import { ENGINE_LABELS } from '~/src/storage/schema';
import {
  getSettings,
  patchSettings,
  onSettingsChanged,
} from '~/src/storage/settings';
import { getKey, setKey, removeKey } from '~/src/storage/keys';
import { tf } from '~/src/i18n';
import { showToast } from '../main';

function savePatch(patch: Parameters<typeof patchSettings>[0]): void {
  patchSettings(patch).catch((e) => console.error('[PT] 设置写入失败:', e));
}

/** 全部可用引擎，顺序即“未启用”区的展示顺序 */
const ALL_ENGINES: EngineId[] = [
  'google-web',
  'bing-edge',
  'openai',
  'deepl',
  'gemini',
];

/** BYOK 引擎的说明文案 key 与模型名占位符（deepl 无模型概念） */
const BYOK_ENGINES: { id: EngineId; descKey: string; model?: string }[] = [
  { id: 'openai', descKey: 'descOpenai', model: 'gpt-4o-mini' },
  { id: 'deepl', descKey: 'descDeepl' },
  { id: 'gemini', descKey: 'descGemini', model: 'gemini-2.0-flash' },
];

const BYOK_FALLBACK_DESC: Record<string, string> = {
  descOpenai: '支持 OpenAI API 及其兼容端点（如 Azure、本地模型）。',
  descDeepl: '免费版 key 以 :fx 结尾，请确认端点正确。',
  descGemini: 'Google Gemini API，key 可从 Google AI Studio 获取。',
};

// ---- Test connection ----

async function testConnection(
  engine: EngineId,
  key: string,
): Promise<{ ok: boolean; msg: string }> {
  try {
    if (engine === 'openai') {
      const resp = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (resp.ok) return { ok: true, msg: tf('testOk', '连接成功') };
      if (resp.status === 401)
        return { ok: false, msg: tf('keyInvalid', 'API key 无效') };
      return { ok: false, msg: `HTTP ${resp.status}` };
    }
    if (engine === 'deepl') {
      const endpoint = key.endsWith(':fx')
        ? 'https://api-free.deepl.com/v2/usage'
        : 'https://api.deepl.com/v2/usage';
      const resp = await fetch(endpoint, {
        headers: { Authorization: `DeepL-Auth-Key ${key}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        const count = String(data.character_count ?? '?');
        return {
          ok: true,
          msg: tf('testOkUsage', `连接成功（已用 ${count} 字符）`, count),
        };
      }
      if (resp.status === 403)
        return { ok: false, msg: tf('keyInvalid', 'API key 无效') };
      return { ok: false, msg: `HTTP ${resp.status}` };
    }
    if (engine === 'gemini') {
      const model = getSettings().models?.gemini ?? 'gemini-2.0-flash';
      // key 走请求头而非 query —— URL 会进浏览器网络日志与各级访问日志，请求头不会
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}`,
        { headers: { 'x-goog-api-key': key } },
      );
      if (resp.ok) return { ok: true, msg: tf('testOk', '连接成功') };
      const data = await resp.json().catch(() => null);
      const errMsg = data?.error?.message ?? `HTTP ${resp.status}`;
      return {
        ok: false,
        msg: `${tf('keyInvalid', 'API key 无效')}：${errMsg}`,
      };
    }
    return { ok: false, msg: `HTTP 0` };
  } catch (e) {
    return { ok: false, msg: tf('netError', `网络错误：${e}`, String(e)) };
  }
}

// ---- Drag & drop ----

let draggedIdx: number | null = null;

function attachDragListeners(listEl: HTMLElement): void {
  listEl.addEventListener('dragstart', (e) => {
    const item = (e.target as HTMLElement).closest('.pt-engine-item') as HTMLElement | null;
    if (!item) return;
    draggedIdx = Array.from(listEl.children).indexOf(item);
    item.classList.add('pt-dragging');
    e.dataTransfer!.effectAllowed = 'move';
  });

  listEl.addEventListener('dragend', (e) => {
    (e.target as HTMLElement).closest('.pt-engine-item')?.classList.remove('pt-dragging');
    draggedIdx = null;
    listEl.querySelectorAll('.pt-drag-over').forEach((el) => el.classList.remove('pt-drag-over'));
  });

  listEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    const item = (e.target as HTMLElement).closest('.pt-engine-item') as HTMLElement | null;
    if (!item || draggedIdx == null) return;
    listEl.querySelectorAll('.pt-drag-over').forEach((el) => el.classList.remove('pt-drag-over'));
    item.classList.add('pt-drag-over');
  });

  listEl.addEventListener('drop', (e) => {
    e.preventDefault();
    const item = (e.target as HTMLElement).closest('.pt-engine-item') as HTMLElement | null;
    if (!item || draggedIdx == null) return;
    item.classList.remove('pt-drag-over');

    const targetIdx = Array.from(listEl.children).indexOf(item);
    if (targetIdx === draggedIdx) return;

    const priority = [...getSettings().enginePriority];
    const [moved] = priority.splice(draggedIdx, 1);
    priority.splice(targetIdx, 0, moved!);
    savePatch({ enginePriority: priority });
  });
}

// ---- Render ----

function renderEngineList(): string {
  const { enginePriority } = getSettings();
  const badgePrimary = tf('badgePrimary', '首选');
  const btnDisable = tf('btnDisable', '停用');
  return enginePriority
    .map(
      (id, i) => `
      <li class="pt-engine-item" draggable="true" data-engine="${id}">
        <span class="pt-engine-handle">⋮⋮</span>
        <span class="pt-engine-name">${ENGINE_LABELS[id]}</span>
        <span class="pt-engine-badge">${i === 0 ? badgePrimary : `#${i + 1}`}</span>
        <span class="pt-engine-actions">
          <button class="pt-btn pt-btn-secondary pt-engine-disable" data-engine="${id}">${btnDisable}</button>
        </span>
      </li>`,
    )
    .join('');
}

/**
 * 未启用引擎区。没有这一块，enginePriority 里没有的引擎就永远进不去 ——
 * BYOK 引擎填了 key、测试连接也成功，route() 却根本不会遍历到它。
 */
function renderDisabledList(): string {
  const { enginePriority } = getSettings();
  const rest = ALL_ENGINES.filter((id) => !enginePriority.includes(id));
  if (rest.length === 0) {
    return `<li class="pt-engine-empty">${tf('cardDisabledEmpty', '全部引擎均已启用。')}</li>`;
  }
  const btnEnable = tf('btnEnable', '启用');
  return rest
    .map(
      (id) => `
      <li class="pt-engine-item" data-engine="${id}">
        <span class="pt-engine-name">${ENGINE_LABELS[id]}</span>
        <span class="pt-engine-actions">
          <button class="pt-btn pt-engine-enable" data-engine="${id}">${btnEnable}</button>
        </span>
      </li>`,
    )
    .join('');
}

function renderByokKeys(): string {
  const keyLabelSuffix = tf('keyLabelSuffix', ' — API Key');
  const keyPlaceholder = tf('keyPlaceholder', '输入 API key…');
  const modelLabel = tf('modelLabel', '模型名');
  const btnTest = tf('btnTest', '测试连接');
  const btnClear = tf('btnClear', '清除');

  return BYOK_ENGINES.map(({ id, descKey, model }) => {
    const desc = tf(descKey, BYOK_FALLBACK_DESC[descKey] ?? '');
    const modelRow = model
      ? `
      <div class="pt-row">
        <span class="pt-row-label">${modelLabel}</span>
        <input
          class="pt-input pt-input-model"
          type="text"
          id="pt-model-${id}"
          placeholder="${model}"
          autocomplete="off"
        />
      </div>`
      : '';

    return `
    <div class="pt-card">
      <div class="pt-card-label">${ENGINE_LABELS[id]}${keyLabelSuffix}</div>
      <p class="pt-section-desc">${desc}</p>
      <div class="pt-key-row">
        <input
          class="pt-input"
          type="password"
          id="pt-key-${id}"
          placeholder="${keyPlaceholder}"
          autocomplete="off"
        />
        <button class="pt-btn" id="pt-test-${id}">${btnTest}</button>
        <button class="pt-btn pt-btn-secondary" id="pt-clear-key-${id}">${btnClear}</button>
      </div>
      <div class="pt-key-result" id="pt-key-result-${id}"></div>${modelRow}
    </div>`;
  }).join('');
}

export function initEngines(): void {
  const listEl = document.getElementById('pt-engine-list')!;
  const disabledEl = document.getElementById('pt-engine-disabled')!;
  const byokEl = document.getElementById('pt-byok-keys')!;

  function renderLists(): void {
    listEl.innerHTML = renderEngineList();
    disabledEl.innerHTML = renderDisabledList();
  }

  // 启用 / 停用走事件委托 —— 列表每次 settings 变更都整体重渲染，
  // 逐项绑定会随重渲染丢失，且旧监听器堆在被替换掉的节点上。
  listEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.pt-engine-disable') as HTMLElement | null;
    if (!btn) return;
    const id = btn.dataset.engine as EngineId;
    const priority = getSettings().enginePriority.filter((x) => x !== id);
    if (priority.length === 0) {
      showToast(tf('engineLastOne', '至少需保留一个引擎'));
      return;
    }
    savePatch({ enginePriority: priority });
  });

  disabledEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.pt-engine-enable') as HTMLElement | null;
    if (!btn) return;
    const id = btn.dataset.engine as EngineId;
    const priority = getSettings().enginePriority;
    if (priority.includes(id)) return;
    savePatch({ enginePriority: [...priority, id] });
  });

  attachDragListeners(listEl);

  function bindByokEvents(): void {
    for (const { id, model } of BYOK_ENGINES) {
      const resultEl = document.getElementById(`pt-key-result-${id}`)!;
      const inputEl = document.getElementById(`pt-key-${id}`) as HTMLInputElement;

      document.getElementById(`pt-test-${id}`)?.addEventListener('click', async () => {
        const key = inputEl?.value.trim();
        if (!key) {
          resultEl.className = 'pt-key-result pt-fail';
          resultEl.textContent = tf('keyRequired', '请输入 API key');
          return;
        }
        resultEl.className = 'pt-key-result';
        resultEl.textContent = tf('testing', '测试中…');
        const result = await testConnection(id, key);
        resultEl.className = `pt-key-result ${result.ok ? 'pt-success' : 'pt-fail'}`;
        resultEl.textContent = result.msg;

        if (result.ok) {
          await setKey(id, key);
          showToast(tf('keySaved', `${ENGINE_LABELS[id]} key 已保存`, ENGINE_LABELS[id]));
        }
      });

      document.getElementById(`pt-clear-key-${id}`)?.addEventListener('click', async () => {
        if (inputEl) inputEl.value = '';
        await removeKey(id);
        resultEl.className = 'pt-key-result';
        resultEl.textContent = tf('keyCleared', 'key 已清除');
        showToast(tf('keyClearedToast', `${ENGINE_LABELS[id]} key 已清除`, ENGINE_LABELS[id]));
      });

      if (!model) continue;
      const modelEl = document.getElementById(`pt-model-${id}`) as HTMLInputElement;
      // 空值即“用默认模型”，写回 undefined 而不是空串 ——
      // 空串会让 `models?.openai ?? 'gpt-4o-mini'` 的兜底失效，请求打到一个空 model。
      modelEl?.addEventListener('change', () => {
        const v = modelEl.value.trim();
        savePatch({ models: { [id]: v || undefined } });
      });
    }
  }

  async function loadKeys(): Promise<void> {
    const models = getSettings().models ?? {};
    for (const { id, model } of BYOK_ENGINES) {
      const key = await getKey(id);
      const inputEl = document.getElementById(`pt-key-${id}`) as HTMLInputElement;
      if (inputEl && key) inputEl.value = key;

      if (!model) continue;
      const modelEl = document.getElementById(`pt-model-${id}`) as HTMLInputElement;
      if (modelEl) modelEl.value = models[id] ?? '';
    }
  }

  renderLists();
  byokEl.innerHTML = renderByokKeys();
  bindByokEvents();
  loadKeys();

  // 只重渲染两个列表 —— BYOK 卡片重渲染会清掉用户正在输入的内容并丢焦点
  onSettingsChanged(() => renderLists());
}
