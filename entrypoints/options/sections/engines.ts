// Phase 7 — 引擎分区：优先级拖拽排序 + BYOK 密钥管理 + 测试连接。

import type { EngineId } from '~/src/storage/schema';
import { ENGINE_LABELS } from '~/src/storage/schema';
import {
  getSettings,
  patchSettings,
  onSettingsChanged,
} from '~/src/storage/settings';
import { getKey, setKey, removeKey } from '~/src/storage/keys';
import { showToast } from '../main';

function savePatch(patch: Parameters<typeof patchSettings>[0]): void {
  patchSettings(patch).catch((e) => console.error('[PT] 设置写入失败:', e));
}

const BYOK_ENGINES: { id: EngineId; desc: string }[] = [
  { id: 'openai', desc: '支持 OpenAI API 及其兼容端点（如 Azure、本地模型）。' },
  { id: 'deepl', desc: '免费版 key 以 :fx 结尾，请确认端点正确。' },
  { id: 'gemini', desc: 'Google Gemini API，key 可从 Google AI Studio 获取。' },
];

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
      if (resp.ok) return { ok: true, msg: '连接成功' };
      if (resp.status === 401)
        return { ok: false, msg: 'API key 无效' };
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
        const count = data.character_count ?? '?';
        return { ok: true, msg: `连接成功（已用 ${count} 字符）` };
      }
      if (resp.status === 403)
        return { ok: false, msg: 'API key 无效' };
      return { ok: false, msg: `HTTP ${resp.status}` };
    }
    if (engine === 'gemini') {
      const model = getSettings().models?.gemini ?? 'gemini-2.0-flash';
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${key}`,
      );
      if (resp.ok) return { ok: true, msg: '连接成功' };
      const data = await resp.json();
      const errMsg = data?.error?.message ?? `HTTP ${resp.status}`;
      return { ok: false, msg: `API key 无效：${errMsg}` };
    }
    return { ok: false, msg: '未知引擎' };
  } catch (e) {
    return { ok: false, msg: `网络错误：${String(e)}` };
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
  return enginePriority
    .map(
      (id, i) => `
      <li class="pt-engine-item" draggable="true">
        <span class="pt-engine-handle">⋮⋮</span>
        <span class="pt-engine-name">${ENGINE_LABELS[id]}</span>
        <span class="pt-engine-badge">${i === 0 ? '首选' : `#${i + 1}`}</span>
      </li>`,
    )
    .join('');
}

function renderByokKeys(): string {
  return BYOK_ENGINES.map(
    ({ id, desc }) => `
    <div class="pt-card">
      <div class="pt-card-label">${ENGINE_LABELS[id]} — API Key</div>
      <p class="pt-section-desc">${desc}</p>
      <div class="pt-key-row">
        <input
          class="pt-input"
          type="password"
          id="pt-key-${id}"
          placeholder="输入 API key…"
          autocomplete="off"
        />
        <button class="pt-btn" id="pt-test-${id}">测试连接</button>
        <button class="pt-btn pt-btn-secondary" id="pt-clear-key-${id}">清除</button>
      </div>
      <div class="pt-key-result" id="pt-key-result-${id}"></div>
    </div>`,
  ).join('');
}

export function initEngines(): void {
  const listEl = document.getElementById('pt-engine-list')!;
  const byokEl = document.getElementById('pt-byok-keys')!;

  function syncUI(): void {
    listEl.innerHTML = renderEngineList();
    attachDragListeners(listEl);

    // BYOK keys only re-render on first load (avoid losing input focus)
    if (!(byokEl as any)._initialized) {
      byokEl.innerHTML = renderByokKeys();
      (byokEl as any)._initialized = true;
      bindByokEvents();
      loadKeys();
    }
  }

  function bindByokEvents(): void {
    for (const { id } of BYOK_ENGINES) {
      const resultEl = document.getElementById(`pt-key-result-${id}`)!;
      const inputEl = document.getElementById(`pt-key-${id}`) as HTMLInputElement;

      document.getElementById(`pt-test-${id}`)?.addEventListener('click', async () => {
        const key = inputEl?.value.trim();
        if (!key) {
          resultEl.className = 'pt-key-result pt-fail';
          resultEl.textContent = '请输入 API key';
          return;
        }
        resultEl.className = 'pt-key-result';
        resultEl.textContent = '测试中…';
        const result = await testConnection(id, key);
        resultEl.className = `pt-key-result ${result.ok ? 'pt-success' : 'pt-fail'}`;
        resultEl.textContent = result.msg;

        // Auto-save on success
        if (result.ok) {
          await setKey(id, key);
          showToast(`${ENGINE_LABELS[id]} key 已保存`);
        }
      });

      document.getElementById(`pt-clear-key-${id}`)?.addEventListener('click', async () => {
        if (inputEl) inputEl.value = '';
        await removeKey(id);
        resultEl.className = 'pt-key-result';
        resultEl.textContent = 'key 已清除';
        showToast(`${ENGINE_LABELS[id]} key 已清除`);
      });
    }
  }

  async function loadKeys(): Promise<void> {
    for (const { id } of BYOK_ENGINES) {
      const key = await getKey(id);
      const inputEl = document.getElementById(`pt-key-${id}`) as HTMLInputElement;
      if (inputEl && key) {
        inputEl.value = key;
      }
    }
  }

  syncUI();
  onSettingsChanged(() => {
    listEl.innerHTML = renderEngineList();
    attachDragListeners(listEl);
  });
}
