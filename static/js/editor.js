/**
 * editor.js — MakerThing page editor
 *
 * Responsibilities:
 *  - Block lifecycle: add, delete, move (keyboard + buttons)
 *  - Block selection and inspector sync
 *  - Drag-and-drop reordering
 *  - Page management (add, switch)
 *  - Auto-save with debounce + manual save
 *  - Accessible announcements via live region
 *  - Toast notifications
 */

'use strict';

// ── State ────────────────────────────────────────────────────────────────────

let selectedBlock = null;
let saveTimeout   = null;
let isDragging    = false;
let dragBlock     = null;

// ── DOM refs (populated on DOMContentLoaded) ─────────────────────────────────

let canvas, liveRegion, toast, saveDot, saveLabel,
    pageTitleInput, blockAlignSelect, blockPaddingSelect, blockIdInput;

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  canvas           = document.getElementById('page-canvas');
  liveRegion       = document.getElementById('live-region');
  toast            = document.getElementById('toast');
  saveDot          = document.getElementById('save-dot');
  saveLabel        = document.getElementById('save-label');
  pageTitleInput   = document.getElementById('page-title-input');
  blockAlignSelect = document.getElementById('block-align');
  blockPaddingSelect = document.getElementById('block-padding');
  blockIdInput     = document.getElementById('block-id-input');

  // Select the pre-rendered hero block if present
  const initial = canvas.querySelector('.page-block');
  if (initial) selectBlock(initial);

  // Mark unsaved on any contenteditable or title edits
  canvas.addEventListener('input', markUnsaved);
  pageTitleInput.addEventListener('input', markUnsaved);

  // Inspector controls
  blockAlignSelect.addEventListener('change', applyInspector);
  blockPaddingSelect.addEventListener('change', applyInspector);
  blockIdInput.addEventListener('input', applyBlockId);

  // Deselect when clicking the bare canvas background
  canvas.addEventListener('click', (e) => {
    if (e.target === canvas) deselectAll();
  });

  initDragAndDrop();
});

// ── Announce (screen reader live region) ─────────────────────────────────────

function announce(msg) {
  // Clear first so identical back-to-back messages still fire
  liveRegion.textContent = '';
  setTimeout(() => { liveRegion.textContent = msg; }, 50);
}

// ── Block selection ──────────────────────────────────────────────────────────

function selectBlock(el) {
  deselectAll();
  el.classList.add('selected');
  selectedBlock = el;
  syncInspector(el);
  announce('Selected ' + (el.dataset.blockType || 'block') + ' block');
}

function deselectAll() {
  document.querySelectorAll('.page-block').forEach(b => b.classList.remove('selected'));
  selectedBlock = null;
}

// Called from inline onclick on each block article
window.selectBlock = selectBlock;

// ── Keyboard shortcuts on blocks ─────────────────────────────────────────────

window.blockKeydown = function blockKeydown(e, el) {
  // Enter / Space → select
  if ((e.key === 'Enter' || e.key === ' ') && e.target === el) {
    e.preventDefault();
    selectBlock(el);
    return;
  }
  // Alt + ↑/↓ → reorder
  if (e.altKey && e.key === 'ArrowUp')   { e.preventDefault(); moveBlock(el, 'up');   return; }
  if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); moveBlock(el, 'down'); return; }
  // Ctrl/Cmd + Delete → delete
  if ((e.ctrlKey || e.metaKey) && e.key === 'Delete') {
    e.preventDefault();
    deleteBlock(el);
  }
};

// ── Block HTML templates ──────────────────────────────────────────────────────

const BLOCK_ICONS = {
  hero:    `<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="9" x2="17" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/>`,
  heading: `<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="17" x2="11" y2="17"/>`,
  text:    `<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="4" y1="14" x2="20" y2="14"/><line x1="4" y1="18" x2="15" y2="18"/>`,
  image:   `<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>`,
  columns: `<rect x="3" y="3" width="8" height="18" rx="1"/><rect x="13" y="3" width="8" height="18" rx="1"/>`,
  button:  `<rect x="2" y="7" width="20" height="10" rx="5"/><line x1="7" y1="12" x2="17" y2="12"/>`,
  divider: `<line x1="4" y1="12" x2="20" y2="12"/><circle cx="12" cy="12" r="2"/>`,
};

const BLOCK_INNER = {
  hero: () => `
    <div class="block-inner block-hero">
      <h1 contenteditable="true" aria-label="Hero headline" spellcheck="true">New headline</h1>
      <p contenteditable="true" aria-label="Hero subtext" spellcheck="true">Your subtitle goes here.</p>
      <div class="hero-cta">
        <button class="primary" contenteditable="true" aria-label="Primary call to action">Get started</button>
      </div>
    </div>`,

  heading: () => `
    <div class="block-inner block-heading">
      <h2 contenteditable="true" aria-label="Heading" spellcheck="true">Section heading</h2>
    </div>`,

  text: () => `
    <div class="block-inner block-text">
      <p contenteditable="true" data-placeholder="Start typing…" aria-label="Text content" spellcheck="true"></p>
    </div>`,

  image: () => `
    <div class="block-inner block-image">
      <div class="img-placeholder" role="button" tabindex="0"
           aria-label="Click to upload image"
           onclick="triggerImageUpload(this)"
           onkeydown="if(event.key==='Enter'||event.key===' ')triggerImageUpload(this)">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <path d="m21 15-5-5L5 21"/>
        </svg>
        Click to upload an image
      </div>
    </div>`,

  columns: () => `
    <div class="block-inner block-columns">
      <div class="cols">
        <div class="col-cell" contenteditable="true" aria-label="Left column content" spellcheck="true">Left column content</div>
        <div class="col-cell" contenteditable="true" aria-label="Right column content" spellcheck="true">Right column content</div>
      </div>
    </div>`,

  button: () => `
    <div class="block-inner block-button">
      <button class="primary" contenteditable="true" aria-label="Button label">Click me</button>
    </div>`,

  divider: () => `
    <div class="block-inner block-divider"><hr aria-hidden="true"></div>`,
};

// ── Block element factory ─────────────────────────────────────────────────────

function makeDropZone() {
  const dz = document.createElement('div');
  dz.className = 'drop-zone';
  dz.setAttribute('role', 'none');
  return dz;
}

function makeBlockEl(type) {
  if (!BLOCK_INNER[type]) {
    console.warn('Unknown block type:', type);
    return null;
  }

  const article = document.createElement('article');
  article.className   = 'page-block';
  article.setAttribute('role',           'listitem');
  article.setAttribute('aria-label',     type + ' block');
  article.setAttribute('data-block-type', type);
  article.setAttribute('tabindex',       '0');
  article.setAttribute('draggable',      'true');
  article.setAttribute('onclick',        'selectBlock(this)');
  article.setAttribute('onkeydown',      'blockKeydown(event,this)');

  article.innerHTML = `
    <div class="drag-handle" aria-hidden="true" title="Drag to reorder (or use Alt + Arrow keys)">
      <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
        <circle cx="3" cy="2"  r="1.5"/>
        <circle cx="7" cy="2"  r="1.5"/>
        <circle cx="3" cy="8"  r="1.5"/>
        <circle cx="7" cy="8"  r="1.5"/>
        <circle cx="3" cy="14" r="1.5"/>
        <circle cx="7" cy="14" r="1.5"/>
      </svg>
    </div>

    <div class="block-toolbar" role="toolbar" aria-label="${type} block actions">
      <button class="icon-btn" title="Move up (Alt+↑)"
              aria-label="Move ${type} block up"
              onclick="event.stopPropagation(); moveBlock(this.closest('.page-block'),'up')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>
      </button>
      <button class="icon-btn" title="Move down (Alt+↓)"
              aria-label="Move ${type} block down"
              onclick="event.stopPropagation(); moveBlock(this.closest('.page-block'),'down')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <button class="icon-btn" title="Duplicate block"
              aria-label="Duplicate ${type} block"
              onclick="event.stopPropagation(); duplicateBlock(this.closest('.page-block'))">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
      <button class="icon-btn danger" title="Delete block (Ctrl+Delete)"
              aria-label="Delete ${type} block"
              onclick="event.stopPropagation(); deleteBlock(this.closest('.page-block'))">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>

    ${BLOCK_INNER[type]()}
  `;

  // Attach drag events to the handle
  const handle = article.querySelector('.drag-handle');
  handle.addEventListener('mousedown', () => { article.setAttribute('draggable', 'true'); });

  return article;
}

// ── Add block ─────────────────────────────────────────────────────────────────

window.addBlock = function addBlock(type) {
  const block = makeBlockEl(type);
  if (!block) return;

  canvas.appendChild(block);
  canvas.appendChild(makeDropZone());

  selectBlock(block);
  block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  announce(type + ' block added');
  markUnsaved();
};

// ── Delete block ──────────────────────────────────────────────────────────────

window.deleteBlock = function deleteBlock(el) {
  const type = el.dataset.blockType || 'block';
  if (!confirm('Delete this ' + type + ' block?')) return;

  // Remove the following drop-zone sibling too
  const sibling = el.nextElementSibling;
  if (sibling && sibling.classList.contains('drop-zone')) sibling.remove();
  el.remove();

  selectedBlock = null;
  announce(type + ' block deleted');
  markUnsaved();
};

// ── Duplicate block ───────────────────────────────────────────────────────────

window.duplicateBlock = function duplicateBlock(el) {
  const type  = el.dataset.blockType || 'text';
  const clone = makeBlockEl(type);
  if (!clone) return;

  // Copy contenteditable values from original
  const srcEdits = el.querySelectorAll('[contenteditable]');
  const dstEdits = clone.querySelectorAll('[contenteditable]');
  srcEdits.forEach((src, i) => {
    if (dstEdits[i]) dstEdits[i].innerHTML = src.innerHTML;
  });

  const dz = makeDropZone();
  el.after(dz, clone);  // insert after current block
  // then add another drop zone after clone if none exists
  if (!clone.nextElementSibling || !clone.nextElementSibling.classList.contains('drop-zone')) {
    clone.after(makeDropZone());
  }

  selectBlock(clone);
  announce(type + ' block duplicated');
  markUnsaved();
};

// ── Move block (keyboard / button) ───────────────────────────────────────────

window.moveBlock = function moveBlock(el, dir) {
  const blocks = [...canvas.querySelectorAll('.page-block')];
  const idx    = blocks.indexOf(el);

  if (dir === 'up' && idx > 0) {
    const target = blocks[idx - 1];
    // Move el and its preceding drop-zone to before target's preceding drop-zone
    const elDZ     = el.previousElementSibling;
    const targetDZ = target.previousElementSibling;
    if (targetDZ && targetDZ.classList.contains('drop-zone')) {
      canvas.insertBefore(el,   targetDZ);
      canvas.insertBefore(elDZ, target);
    }
    announce('Block moved up');
  } else if (dir === 'down' && idx < blocks.length - 1) {
    const target = blocks[idx + 1];
    const targetDZ = target.nextElementSibling;
    canvas.insertBefore(el, targetDZ ? targetDZ.nextElementSibling : null);
    const elDZ = el.previousElementSibling;
    if (elDZ && elDZ.classList.contains('drop-zone')) {
      canvas.insertBefore(elDZ, el);
    }
    announce('Block moved down');
  }

  markUnsaved();
};

// ── Drag-and-drop reordering ──────────────────────────────────────────────────

function initDragAndDrop() {
  canvas.addEventListener('dragstart', onDragStart);
  canvas.addEventListener('dragover',  onDragOver);
  canvas.addEventListener('dragenter', onDragEnter);
  canvas.addEventListener('dragleave', onDragLeave);
  canvas.addEventListener('drop',      onDrop);
  canvas.addEventListener('dragend',   onDragEnd);
}

function onDragStart(e) {
  dragBlock = e.target.closest('.page-block');
  if (!dragBlock) return;
  isDragging = true;
  dragBlock.style.opacity = '0.4';
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', ''); // required for Firefox
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function onDragEnter(e) {
  const dz = e.target.closest('.drop-zone');
  if (dz) dz.classList.add('over');
}

function onDragLeave(e) {
  const dz = e.target.closest('.drop-zone');
  if (dz && !dz.contains(e.relatedTarget)) dz.classList.remove('over');
}

function onDrop(e) {
  e.preventDefault();
  const dz = e.target.closest('.drop-zone');
  if (!dz || !dragBlock) return;

  // Insert block before the drop zone, then move the dz before the block
  dz.classList.remove('over');
  dz.after(dragBlock);
  dragBlock.before(dz);

  markUnsaved();
  announce('Block moved');
}

function onDragEnd() {
  if (dragBlock) dragBlock.style.opacity = '';
  canvas.querySelectorAll('.drop-zone').forEach(dz => dz.classList.remove('over'));
  isDragging = false;
  dragBlock  = null;
}

// ── Image upload stub ─────────────────────────────────────────────────────────

window.triggerImageUpload = function triggerImageUpload(placeholder) {
  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = document.createElement('img');
    img.src   = url;
    img.alt   = file.name.replace(/\.[^.]+$/, '');
    img.style.cssText = 'max-width:100%;border-radius:var(--radius);display:block;margin:0 auto;';
    placeholder.replaceWith(img);
    markUnsaved();
  });
  input.click();
};

// ── Inspector ─────────────────────────────────────────────────────────────────

function syncInspector(block) {
  if (!block) return;
  const inner = block.querySelector('.block-inner');
  if (!inner) return;

  const computedAlign   = inner.style.textAlign   || 'left';
  const computedPadding = inner.style.paddingTop   || '24px';

  // Normalise padding: map computed value back to select options
  const paddingMap = { '16px': '16px', '32px': '32px', '56px': '56px' };
  blockAlignSelect.value   = computedAlign in { left:1, center:1, right:1 } ? computedAlign : 'left';
  blockPaddingSelect.value = paddingMap[computedPadding] || '32px';
  blockIdInput.value       = block.id || '';
}

function applyInspector() {
  if (!selectedBlock) return;
  const inner = selectedBlock.querySelector('.block-inner');
  if (!inner) return;
  inner.style.textAlign = blockAlignSelect.value;
  inner.style.padding   = blockPaddingSelect.value;
  markUnsaved();
}

function applyBlockId() {
  if (!selectedBlock) return;
  const val = blockIdInput.value.trim();
  if (val) {
    selectedBlock.id = val;
  } else {
    selectedBlock.removeAttribute('id');
  }
  markUnsaved();
}

window.setSwatch = function setSwatch(btn, color) {
  document.querySelectorAll('.color-swatch').forEach(s => {
    s.classList.remove('active');
    s.setAttribute('aria-pressed', 'false');
    s.style.borderColor = 'transparent';
  });
  btn.classList.add('active');
  btn.setAttribute('aria-pressed', 'true');
  btn.style.borderColor = 'var(--accent)';
  if (selectedBlock) {
    selectedBlock.style.background = color;
    markUnsaved();
  }
};

// ── Page management ───────────────────────────────────────────────────────────

window.addPage = function addPage() {
  const name = prompt('Page name:');
  if (!name || !name.trim()) return;

  const list = document.getElementById('pages-list');
  const btn  = document.createElement('button');
  btn.className = 'page-item';
  btn.setAttribute('role',        'listitem');
  btn.setAttribute('aria-current', 'false');
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" width="14" height="14">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
    ${escapeHtml(name.trim())}`;

  btn.addEventListener('click', () => switchPage(btn, name.trim()));
  list.appendChild(btn);
  announce('Page "' + name.trim() + '" added');
};

function switchPage(btn, name) {
  document.querySelectorAll('.page-item').forEach(p => {
    p.classList.remove('active');
    p.setAttribute('aria-current', 'false');
  });
  btn.classList.add('active');
  btn.setAttribute('aria-current', 'page');
  // In a real app: fetch page blocks from the server here
  pageTitleInput.value = name;
  announce('Switched to page: ' + name);
}

// ── Save / publish ────────────────────────────────────────────────────────────

function markUnsaved() {
  saveDot.classList.remove('saved');
  saveLabel.textContent = 'Unsaved';
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(savePage, 3000);
}

window.savePage = function savePage() {
  // Build a lightweight JSON model of the page
  const pageData = serializePage();

  // In a real app: POST pageData to /api/pages/<id>
  // fetch('/api/pages/' + pageId, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(pageData) })

  saveDot.classList.add('saved');
  saveLabel.textContent = 'Saved';
  showToast('Page saved');
  console.log('[MakerThing] Page data:', pageData);
};

window.previewPage = function previewPage() {
  // In a real app: open /preview/<page_slug> in a new tab
  showToast('Preview opening…');
};

// ── Page serialisation (block-JSON model) ─────────────────────────────────────

function serializePage() {
  const blocks = [...canvas.querySelectorAll('.page-block')].map(block => {
    const type  = block.dataset.blockType;
    const inner = block.querySelector('.block-inner');
    const data  = {};

    // Collect all contenteditable fields keyed by their aria-label
    block.querySelectorAll('[contenteditable]').forEach(el => {
      const key   = el.getAttribute('aria-label') || el.tagName.toLowerCase();
      data[key]   = el.innerHTML.trim();
    });

    return {
      type,
      id:         block.id || null,
      background: block.style.background || null,
      style: {
        textAlign: inner ? inner.style.textAlign  || null : null,
        padding:   inner ? inner.style.paddingTop || null : null,
      },
      data,
    };
  });

  return {
    title:  pageTitleInput.value.trim(),
    blocks,
    savedAt: new Date().toISOString(),
  };
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2200);
}

// ── Utility ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}