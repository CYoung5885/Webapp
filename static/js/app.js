/**
 * app.js — MakerThing entry point / module coordinator
 *
 * Responsibilities:
 *  - Boot sequence and global state initialisation
 *  - Wire editor, model, preview, exporter together
 *  - Own the current page/session state
 *  - Expose a single `App` namespace to other modules
 */

'use strict';

// ── Global app state ──────────────────────────────────────────────────────────

const App = {
  currentPageId:   null,   // active page ID (synced with backend)
  pages:           [],     // [{ id, title, slug }] — lightweight index
  isDirty:         false,  // unsaved changes flag
  isLoading:       false,  // in-flight request guard
};

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await boot();
  } catch (err) {
    console.error('[MakerThing] Boot failed:', err);
    showFatalError('Failed to load the editor. Please refresh the page.');
  }
});

async function boot() {
  // 1. Load page index from backend
  const pages = await Model.fetchPages();
  App.pages = pages;

  // 2. Render pages list in sidebar
  renderPagesList(pages);

  // 3. Load first page (or whatever is marked active)
  const firstPage = pages[0] ?? null;
  if (firstPage) {
    await loadPage(firstPage.id);
  }

  // 4. Wire up topbar save / preview / publish
  wireTopbar();

  // 5. Wire up beforeunload guard
  window.addEventListener('beforeunload', (e) => {
    if (App.isDirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  console.log('[MakerThing] Ready.');
}

// ── Page loading ──────────────────────────────────────────────────────────────

async function loadPage(pageId) {
  if (App.isLoading) return;
  App.isLoading = true;

  try {
    const page = await Model.fetchPage(pageId);
    App.currentPageId = page.id;

    // Hand off to editor
    if (typeof Editor !== 'undefined') {
      Editor.loadPage(page);
    }

    // Update topbar title
    const titleInput = document.getElementById('page-title-input');
    if (titleInput) titleInput.value = page.title ?? '';

    // Sync active state in sidebar
    highlightActivePage(pageId);

    App.isDirty = false;
    setSaveStatus('saved');

  } catch (err) {
    console.error('[MakerThing] loadPage failed:', err);
    showToastError('Could not load page.');
  } finally {
    App.isLoading = false;
  }
}

// Exposed so editor.js / sidebar clicks can trigger a page switch
window.switchToPage = async function switchToPage(pageId) {
  if (pageId === App.currentPageId) return;

  if (App.isDirty) {
    const ok = confirm('You have unsaved changes. Discard and switch page?');
    if (!ok) return;
  }

  await loadPage(pageId);
};

// ── Page saving ───────────────────────────────────────────────────────────────

window.savePage = async function savePage() {
  if (!App.currentPageId) return;
  if (App.isLoading) return;
  App.isLoading = true;

  setSaveStatus('saving');

  try {
    // editor.js exposes serializePage() on window
    const pageData = typeof serializePage === 'function'
      ? serializePage()
      : { title: '', blocks: [] };

    await Model.savePage(App.currentPageId, pageData);

    App.isDirty = false;
    setSaveStatus('saved');
    showToast('Page saved');

  } catch (err) {
    console.error('[MakerThing] savePage failed:', err);
    setSaveStatus('unsaved');
    showToastError('Save failed — ' + (err.message ?? 'unknown error'));
  } finally {
    App.isLoading = false;
  }
};

// ── Add page ──────────────────────────────────────────────────────────────────

window.addPage = async function addPage() {
  const name = prompt('Page name:');
  if (!name || !name.trim()) return;

  try {
    const newPage = await Model.createPage({ title: name.trim() });
    App.pages.push(newPage);
    appendPageToSidebar(newPage);
    await loadPage(newPage.id);
    announce('Page "' + newPage.title + '" created');
  } catch (err) {
    console.error('[MakerThing] addPage failed:', err);
    showToastError('Could not create page.');
  }
};

// ── Delete page ───────────────────────────────────────────────────────────────

window.deletePage = async function deletePage(pageId) {
  if (App.pages.length <= 1) {
    showToastError('You must have at least one page.');
    return;
  }
  if (!confirm('Delete this page? This cannot be undone.')) return;

  try {
    await Model.deletePage(pageId);
    App.pages = App.pages.filter(p => p.id !== pageId);

    // Remove from sidebar
    const btn = document.querySelector(`.page-item[data-page-id="${pageId}"]`);
    if (btn) btn.remove();

    // Switch to first remaining page
    if (App.currentPageId === pageId) {
      await loadPage(App.pages[0].id);
    }

    announce('Page deleted');
  } catch (err) {
    console.error('[MakerThing] deletePage failed:', err);
    showToastError('Could not delete page.');
  }
};

// ── Preview ───────────────────────────────────────────────────────────────────

window.previewPage = function previewPage() {
  if (!App.currentPageId) return;
  window.open('/preview/' + App.currentPageId, '_blank', 'noopener');
};

// ── Sidebar rendering ─────────────────────────────────────────────────────────

function renderPagesList(pages) {
  const list = document.getElementById('pages-list');
  if (!list) return;
  list.innerHTML = '';
  pages.forEach(page => appendPageToSidebar(page));
}

function appendPageToSidebar(page) {
  const list = document.getElementById('pages-list');
  if (!list) return;

  const btn = document.createElement('button');
  btn.className = 'page-item';
  btn.setAttribute('role',         'listitem');
  btn.setAttribute('aria-current', 'false');
  btn.setAttribute('data-page-id', page.id);

  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" width="14" height="14">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
    ${escapeHtml(page.title)}`;

  btn.addEventListener('click', () => switchToPage(page.id));
  list.appendChild(btn);
}

function highlightActivePage(pageId) {
  document.querySelectorAll('.page-item').forEach(btn => {
    const active = btn.dataset.pageId === String(pageId);
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  });
}

// ── Topbar wiring ─────────────────────────────────────────────────────────────

function wireTopbar() {
  const titleInput = document.getElementById('page-title-input');
  if (titleInput) {
    titleInput.addEventListener('input', () => {
      App.isDirty = true;
      setSaveStatus('unsaved');
    });
  }
}

// ── Dirty-state bridge (called by editor.js) ──────────────────────────────────

// editor.js calls markUnsaved(); we redefine it here so App.isDirty stays in sync.
window.markUnsaved = function markUnsaved() {
  App.isDirty = true;
  setSaveStatus('unsaved');

  clearTimeout(App._saveTimeout);
  App._saveTimeout = setTimeout(savePage, 3000);
};

// ── Save status UI ────────────────────────────────────────────────────────────

function setSaveStatus(state) {
  const dot   = document.getElementById('save-dot');
  const label = document.getElementById('save-label');
  if (!dot || !label) return;

  const states = {
    saved:   { dot: true,  text: 'Saved'  },
    unsaved: { dot: false, text: 'Unsaved' },
    saving:  { dot: false, text: 'Saving…' },
  };

  const s = states[state] ?? states.unsaved;
  dot.classList.toggle('saved', s.dot);
  label.textContent = s.text;
}

// ── Toast helpers ─────────────────────────────────────────────────────────────

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(App._toastTimeout);
  App._toastTimeout = setTimeout(() => toast.classList.remove('show'), 2200);
}

function showToastError(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = '⚠ ' + msg;
  toast.style.background = 'var(--danger)';
  toast.classList.add('show');
  clearTimeout(App._toastTimeout);
  App._toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
    toast.style.background = '';
  }, 3500);
}

// ── Fatal error ───────────────────────────────────────────────────────────────

function showFatalError(msg) {
  const layout = document.getElementById('editor-layout');
  if (!layout) return;
  layout.innerHTML = `
    <div style="margin:auto;padding:48px;text-align:center;color:var(--text-muted)">
      <p style="font-size:15px;margin-bottom:8px">${escapeHtml(msg)}</p>
      <button onclick="location.reload()">Reload</button>
    </div>`;
}

// ── Live region ───────────────────────────────────────────────────────────────

function announce(msg) {
  const region = document.getElementById('live-region');
  if (!region) return;
  region.textContent = '';
  setTimeout(() => { region.textContent = msg; }, 50);
}

// ── Utility ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}