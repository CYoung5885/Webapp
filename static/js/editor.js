/**
 * editor.js — MakerThing block + element editor
 *
 * Blocks are position:relative containers.
 * Elements inside are position:absolute, stored as % coords.
 *
 * Exposed globals (called by app.js / index.html):
 *   addBlock(type)
 *   deleteBlock(el)
 *   duplicateBlock(el)
 *   moveBlock(el, dir)
 *   selectBlock(el)
 *   blockKeydown(e, el)
 *   triggerImageUpload(placeholder)
 *   setSwatch(btn, color)
 *   serializePage()
 *   loadPage(page)         ← called by app.js after fetch
 */

'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

const SNAP_PX      = 8;           // optional grid snap size
const MIN_BLOCK_H  = 80;          // px — minimum block height
const ELEMENT_TYPES = ['text', 'heading', 'image', 'button', 'divider'];

// ── State ─────────────────────────────────────────────────────────────────────

let selectedBlock   = null;
let selectedElement = null;
let isDraggingEl    = false;
let isResizingBlock = false;
let snapEnabled     = false;

// per-element drag bookkeeping
let _elDrag = null;
// { el, blockEl, startMouseX, startMouseY, startLeft, startTop, blockW, blockH }

// block resize bookkeeping
let _blockResize = null;
// { blockEl, startMouseY, startH }

// ── DOM refs ──────────────────────────────────────────────────────────────────

let canvas, liveRegion, pageTitleInput;

// Inspector — block-level
let inspBlockBg, inspBlockPadding, inspBlockId, inspSnapToggle;

// Inspector — element-level
let inspElPanel, inspElType,
    inspFontSize, inspFontWeight, inspFontColor,
    inspPaddingTop, inspPaddingRight, inspPaddingBottom, inspPaddingLeft,
    inspMarginTop, inspMarginRight, inspMarginBottom, inspMarginLeft,
    inspHref, inspHrefRow, inspZIndex;

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  canvas         = document.getElementById('page-canvas');
  liveRegion     = document.getElementById('live-region');
  pageTitleInput = document.getElementById('page-title-input');

  // Block inspector refs
  inspBlockBg      = document.getElementById('insp-block-bg');
  inspBlockPadding = document.getElementById('insp-block-padding');
  inspBlockId      = document.getElementById('insp-block-id');
  inspSnapToggle   = document.getElementById('insp-snap-toggle');

  // Element inspector refs
  inspElPanel      = document.getElementById('insp-el-panel');
  inspElType       = document.getElementById('insp-el-type');
  inspFontSize     = document.getElementById('insp-font-size');
  inspFontWeight   = document.getElementById('insp-font-weight');
  inspFontColor    = document.getElementById('insp-font-color');
  inspPaddingTop   = document.getElementById('insp-padding-top');
  inspPaddingRight = document.getElementById('insp-padding-right');
  inspPaddingBottom= document.getElementById('insp-padding-bottom');
  inspPaddingLeft  = document.getElementById('insp-padding-left');
  inspMarginTop    = document.getElementById('insp-margin-top');
  inspMarginRight  = document.getElementById('insp-margin-right');
  inspMarginBottom = document.getElementById('insp-margin-bottom');
  inspMarginLeft   = document.getElementById('insp-margin-left');
  inspHref         = document.getElementById('insp-href');
  inspHrefRow      = document.getElementById('insp-href-row');
  inspZIndex       = document.getElementById('insp-z-index');

  // Wire inspector inputs
  [inspFontSize, inspFontWeight, inspFontColor,
   inspPaddingTop, inspPaddingRight, inspPaddingBottom, inspPaddingLeft,
   inspMarginTop, inspMarginRight, inspMarginBottom, inspMarginLeft,
   inspHref, inspZIndex].forEach(el => {
    if (el) el.addEventListener('input', applyElementInspector);
  });

  if (inspBlockPadding) inspBlockPadding.addEventListener('change', applyBlockInspector);
  if (inspBlockId)      inspBlockId.addEventListener('input',  applyBlockId);
  if (inspSnapToggle)   inspSnapToggle.addEventListener('change', () => {
    snapEnabled = inspSnapToggle.checked;
  });

  // Block background swatches handled by setSwatch()

  // Canvas click → deselect
  canvas.addEventListener('click', (e) => {
    if (e.target === canvas) { deselectAll(); }
  });

  // Global mouse move/up for dragging elements and resizing blocks
  document.addEventListener('mousemove', onGlobalMouseMove);
  document.addEventListener('mouseup',   onGlobalMouseUp);

  // Title marks dirty
  if (pageTitleInput) pageTitleInput.addEventListener('input', markUnsaved);

  // Select pre-rendered block if any
  const initial = canvas.querySelector('.page-block');
  if (initial) selectBlock(initial);
});

// ── Announce ──────────────────────────────────────────────────────────────────

function announce(msg) {
  if (!liveRegion) return;
  liveRegion.textContent = '';
  setTimeout(() => { liveRegion.textContent = msg; }, 50);
}

// ── Selection ─────────────────────────────────────────────────────────────────

function selectBlock(blockEl) {
  if (selectedBlock === blockEl && !selectedElement) return;
  deselectAll();
  blockEl.classList.add('selected');
  selectedBlock = blockEl;
  syncBlockInspector(blockEl);
  showBlockInspector();
  announce('Selected ' + (blockEl.dataset.blockType || 'block') + ' block');
}
window.selectBlock = selectBlock;

function selectElement(elEl, blockEl) {
  deselectAllElements();
  elEl.classList.add('el-selected');
  selectedElement = elEl;
  if (selectedBlock !== blockEl) {
    deselectAllBlocks();
    blockEl.classList.add('selected');
    selectedBlock = blockEl;
  }
  syncElementInspector(elEl);
  showElementInspector();
}

function deselectAll() {
  deselectAllBlocks();
  deselectAllElements();
  showEmptyInspector();
}

function deselectAllBlocks() {
  document.querySelectorAll('.page-block').forEach(b => b.classList.remove('selected'));
  selectedBlock = null;
}

function deselectAllElements() {
  document.querySelectorAll('.block-element').forEach(e => e.classList.remove('el-selected'));
  selectedElement = null;
}

// ── Inspector panels ──────────────────────────────────────────────────────────

function showBlockInspector() {
  document.getElementById('insp-block-panel').style.display = '';
  document.getElementById('insp-el-panel').style.display    = 'none';
  document.getElementById('insp-empty').style.display       = 'none';
}

function showElementInspector() {
  document.getElementById('insp-block-panel').style.display = 'none';
  document.getElementById('insp-el-panel').style.display    = '';
  document.getElementById('insp-empty').style.display       = 'none';
}

function showEmptyInspector() {
  document.getElementById('insp-block-panel').style.display = 'none';
  document.getElementById('insp-el-panel').style.display    = 'none';
  document.getElementById('insp-empty').style.display       = '';
}

// ── Block inspector sync ──────────────────────────────────────────────────────

function syncBlockInspector(blockEl) {
  if (inspBlockId)      inspBlockId.value      = blockEl.id || '';
  if (inspBlockPadding) inspBlockPadding.value  = blockEl.dataset.padding || '24px';
  // Swatches — mark active
  const currentBg = blockEl.style.background || '#ffffff';
  document.querySelectorAll('.color-swatch').forEach(s => {
    const active = s.dataset.color === currentBg;
    s.classList.toggle('active', active);
    s.setAttribute('aria-pressed', String(active));
  });
}

function applyBlockInspector() {
  if (!selectedBlock) return;
  if (inspBlockPadding) {
    selectedBlock.dataset.padding = inspBlockPadding.value;
    selectedBlock.querySelector('.block-canvas').style.padding = inspBlockPadding.value;
  }
  markUnsaved();
}

function applyBlockId() {
  if (!selectedBlock) return;
  const val = inspBlockId.value.trim();
  if (val) selectedBlock.id = val;
  else     selectedBlock.removeAttribute('id');
  markUnsaved();
}

window.setSwatch = function setSwatch(btn, color) {
  document.querySelectorAll('.color-swatch').forEach(s => {
    s.classList.remove('active');
    s.setAttribute('aria-pressed', 'false');
  });
  btn.classList.add('active');
  btn.setAttribute('aria-pressed', 'true');
  if (selectedBlock) {
    selectedBlock.style.background = color;
    btn.dataset.color = color;
    markUnsaved();
  }
};

// ── Element inspector sync ────────────────────────────────────────────────────

function syncElementInspector(elEl) {
  const type = elEl.dataset.elType || 'text';
  if (inspElType) inspElType.textContent = type.charAt(0).toUpperCase() + type.slice(1);

  const s = elEl.style;
  const inner = elEl.querySelector('.el-inner') || elEl;

  if (inspFontSize)  inspFontSize.value  = parseFloat(inner.style.fontSize)  || 15;
  if (inspFontWeight)inspFontWeight.value= inner.style.fontWeight || '400';
  if (inspFontColor) inspFontColor.value = rgbToHex(inner.style.color) || '#1a1917';

  if (inspPaddingTop)    inspPaddingTop.value    = parseFloat(s.paddingTop)    || 0;
  if (inspPaddingRight)  inspPaddingRight.value  = parseFloat(s.paddingRight)  || 0;
  if (inspPaddingBottom) inspPaddingBottom.value = parseFloat(s.paddingBottom) || 0;
  if (inspPaddingLeft)   inspPaddingLeft.value   = parseFloat(s.paddingLeft)   || 0;

  if (inspMarginTop)    inspMarginTop.value    = parseFloat(s.marginTop)    || 0;
  if (inspMarginRight)  inspMarginRight.value  = parseFloat(s.marginRight)  || 0;
  if (inspMarginBottom) inspMarginBottom.value = parseFloat(s.marginBottom) || 0;
  if (inspMarginLeft)   inspMarginLeft.value   = parseFloat(s.marginLeft)   || 0;

  if (inspZIndex)  inspZIndex.value  = s.zIndex || 1;

  // href — only for button / image
  const showHref = ['button', 'image'].includes(type);
  if (inspHrefRow) inspHrefRow.style.display = showHref ? '' : 'none';
  if (inspHref)    inspHref.value = elEl.dataset.href || '';
}

function applyElementInspector() {
  if (!selectedElement) return;
  const elEl  = selectedElement;
  const inner = elEl.querySelector('.el-inner') || elEl;
  const s     = elEl.style;

  if (inspFontSize)      inner.style.fontSize   = inspFontSize.value   + 'px';
  if (inspFontWeight)    inner.style.fontWeight  = inspFontWeight.value;
  if (inspFontColor)     inner.style.color       = inspFontColor.value;

  if (inspPaddingTop)    s.paddingTop    = inspPaddingTop.value    + 'px';
  if (inspPaddingRight)  s.paddingRight  = inspPaddingRight.value  + 'px';
  if (inspPaddingBottom) s.paddingBottom = inspPaddingBottom.value + 'px';
  if (inspPaddingLeft)   s.paddingLeft   = inspPaddingLeft.value   + 'px';

  if (inspMarginTop)    s.marginTop    = inspMarginTop.value    + 'px';
  if (inspMarginRight)  s.marginRight  = inspMarginRight.value  + 'px';
  if (inspMarginBottom) s.marginBottom = inspMarginBottom.value + 'px';
  if (inspMarginLeft)   s.marginLeft   = inspMarginLeft.value   + 'px';

  if (inspZIndex)  s.zIndex  = inspZIndex.value;
  if (inspHref)    elEl.dataset.href = inspHref.value;

  markUnsaved();
}

window.deleteSelectedElement = function deleteSelectedElement() {
  if (!selectedElement) return;
  const blockEl = selectedElement.closest('.page-block');
  selectedElement.remove();
  selectedElement = null;
  if (blockEl) recalcBlockHeight(blockEl);
  showBlockInspector();
  markUnsaved();
  announce('Element deleted');
};

// ── Element type HTML ─────────────────────────────────────────────────────────

function makeElementInner(type) {
  switch (type) {
    case 'text':
      return `<p class="el-inner" contenteditable="true" spellcheck="true"
                 data-placeholder="Type something…"
                 style="font-size:15px;line-height:1.7;">Type something…</p>`;
    case 'heading':
      return `<h2 class="el-inner" contenteditable="true" spellcheck="true"
                  data-placeholder="Heading"
                  style="font-size:26px;font-weight:700;letter-spacing:-0.3px;">Heading</h2>`;
    case 'image':
      return `<div class="el-inner img-placeholder"
                   role="button" tabindex="0"
                   aria-label="Click to upload image"
                   onclick="triggerImageUpload(this)"
                   onkeydown="if(event.key==='Enter'||event.key===' ')triggerImageUpload(this)"
                   style="min-width:80px;min-height:60px;">
                <svg viewBox="0 0 24 24" aria-hidden="true" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <path d="m21 15-5-5L5 21"/>
                </svg>
                <span>Upload image</span>
              </div>`;
    case 'button':
      return `<button class="el-inner primary" contenteditable="true"
                      style="pointer-events:none;">Click me</button>`;
    case 'divider':
      return `<hr class="el-inner" style="border:none;border-top:1px solid var(--border);width:100%;">`;
    default:
      return `<p class="el-inner" contenteditable="true">Element</p>`;
  }
}

// ── Element factory ───────────────────────────────────────────────────────────

function makeElementEl(type, x = 5, y = 5, w = 40) {
  const el = document.createElement('div');
  el.className        = 'block-element';
  el.dataset.elType   = type;
  el.style.left       = x + '%';
  el.style.top        = y + 'px';
  el.style.width      = w + '%';
  el.style.position   = 'absolute';
  el.style.zIndex     = '1';
  el.setAttribute('tabindex', '0');

  el.innerHTML = `
    <div class="el-drag-handle" aria-hidden="true" title="Drag element">
      <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor" aria-hidden="true">
        <circle cx="2" cy="1.5" r="1.2"/><circle cx="6" cy="1.5" r="1.2"/>
        <circle cx="2" cy="6"   r="1.2"/><circle cx="6" cy="6"   r="1.2"/>
        <circle cx="2" cy="10.5" r="1.2"/><circle cx="6" cy="10.5" r="1.2"/>
      </svg>
    </div>
    <div class="el-resize-handle" aria-hidden="true" title="Resize element width"></div>
    ${makeElementInner(type)}
  `;

  // Click to select element
  el.addEventListener('mousedown', (e) => {
    if (e.target.closest('.el-drag-handle') || e.target.closest('.el-resize-handle')) return;
    if (e.target.getAttribute('contenteditable')) return;
    e.stopPropagation();
    const blockEl = el.closest('.page-block');
    selectElement(el, blockEl);
  });

  el.addEventListener('click', (e) => {
    e.stopPropagation();
    const blockEl = el.closest('.page-block');
    if (!e.target.getAttribute('contenteditable')) selectElement(el, blockEl);
  });

  el.addEventListener('focusin', (e) => {
    const blockEl = el.closest('.page-block');
    selectElement(el, blockEl);
  });

  // Drag handle — start element drag
  const dragHandle = el.querySelector('.el-drag-handle');
  dragHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const blockEl   = el.closest('.page-block');
    const blockCanvas = blockEl.querySelector('.block-canvas');
    const bcRect    = blockCanvas.getBoundingClientRect();
    selectElement(el, blockEl);
    _elDrag = {
      el,
      blockEl,
      blockCanvas,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startLeft:   parseFloat(el.style.left),   // %
      startTop:    parseFloat(el.style.top),     // px
      blockW:      bcRect.width,
      blockH:      bcRect.height,
    };
    isDraggingEl = true;
    el.classList.add('dragging');
  });

  // Resize handle — resize element width
  const resizeHandle = el.querySelector('.el-resize-handle');
  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const blockEl     = el.closest('.page-block');
    const blockCanvas = blockEl.querySelector('.block-canvas');
    const bcRect      = blockCanvas.getBoundingClientRect();
    _elDrag = {
      el,
      blockEl,
      blockCanvas,
      resizing: true,
      startMouseX: e.clientX,
      startW: parseFloat(el.style.width),  // %
      blockW: bcRect.width,
    };
    isDraggingEl = true;
  });

  // Mark content edits as unsaved
  el.addEventListener('input', () => markUnsaved());

  return el;
}

// ── Global mouse handlers ─────────────────────────────────────────────────────

function onGlobalMouseMove(e) {
  if (isDraggingEl && _elDrag) {
    const d = _elDrag;

    if (d.resizing) {
      // Resize width only
      const dxPx  = e.clientX - d.startMouseX;
      let   newW  = d.startW + (dxPx / d.blockW) * 100;
      newW = Math.max(5, Math.min(100, newW));
      d.el.style.width = newW + '%';

    } else {
      // Move position
      const dxPx = e.clientX - d.startMouseX;
      const dyPx = e.clientY - d.startMouseY;

      let newLeftPct = d.startLeft + (dxPx / d.blockW) * 100;
      let newTopPx   = d.startTop  + dyPx;

      // Clamp
      newLeftPct = Math.max(0, Math.min(95, newLeftPct));
      newTopPx   = Math.max(0, newTopPx);

      // Snap
      if (snapEnabled) {
        const snapPct = (SNAP_PX / d.blockW) * 100;
        newLeftPct = Math.round(newLeftPct / snapPct) * snapPct;
        newTopPx   = Math.round(newTopPx   / SNAP_PX) * SNAP_PX;
      }

      d.el.style.left = newLeftPct + '%';
      d.el.style.top  = newTopPx   + 'px';
    }

    recalcBlockHeight(d.blockEl);
    return;
  }

  if (isResizingBlock && _blockResize) {
    const d    = _blockResize;
    const dy   = e.clientY - d.startMouseY;
    const newH = Math.max(MIN_BLOCK_H, d.startH + dy);
    d.blockEl.querySelector('.block-canvas').style.minHeight = newH + 'px';
    d.blockEl.dataset.fixedHeight = newH;
  }
}

function onGlobalMouseUp() {
  if (isDraggingEl && _elDrag) {
    _elDrag.el.classList.remove('dragging');
    recalcBlockHeight(_elDrag.blockEl);
    markUnsaved();
  }
  isDraggingEl    = false;
  _elDrag         = null;
  isResizingBlock = false;
  _blockResize    = null;
}

// ── Block height ──────────────────────────────────────────────────────────────

function recalcBlockHeight(blockEl) {
  if (blockEl.dataset.fixedHeight) return; // user locked height
  const bc = blockEl.querySelector('.block-canvas');
  if (!bc) return;
  let maxBottom = MIN_BLOCK_H;
  bc.querySelectorAll('.block-element').forEach(el => {
    const top    = parseFloat(el.style.top)  || 0;
    const height = el.offsetHeight || 0;
    maxBottom = Math.max(maxBottom, top + height + 24);
  });
  bc.style.minHeight = maxBottom + 'px';
}

// ── Add element to selected block ─────────────────────────────────────────────

window.addElementToBlock = function addElementToBlock(type) {
  if (!selectedBlock) {
    showToast('Select a block first');
    return;
  }
  const bc = selectedBlock.querySelector('.block-canvas');
  if (!bc) return;

  // Offset each new element slightly so they don't stack perfectly
  const count = bc.querySelectorAll('.block-element').length;
  const x     = 5 + (count % 3) * 2;
  const y     = 10 + count * 28;

  const elEl  = makeElementEl(type, x, y, 40);
  bc.appendChild(elEl);
  selectElement(elEl, selectedBlock);
  recalcBlockHeight(selectedBlock);
  markUnsaved();
  announce(type + ' element added');
};

// ── Block factory ─────────────────────────────────────────────────────────────

function makeDropZone() {
  const dz = document.createElement('div');
  dz.className = 'drop-zone';
  dz.setAttribute('role', 'none');
  return dz;
}

function makeBlockEl(type, elements = null) {
  const article = document.createElement('article');
  article.className            = 'page-block';
  article.dataset.blockType    = type;
  article.dataset.padding      = '24px';
  article.setAttribute('role', 'listitem');
  article.setAttribute('tabindex', '0');
  article.setAttribute('aria-label', type + ' block');

  article.innerHTML = `
    <div class="drag-handle" aria-hidden="true" title="Drag block (Alt+↑↓)">
      <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
        <circle cx="3" cy="2"  r="1.5"/><circle cx="7" cy="2"  r="1.5"/>
        <circle cx="3" cy="8"  r="1.5"/><circle cx="7" cy="8"  r="1.5"/>
        <circle cx="3" cy="14" r="1.5"/><circle cx="7" cy="14" r="1.5"/>
      </svg>
    </div>

    <div class="block-toolbar" role="toolbar" aria-label="${type} block actions">
      <button class="icon-btn" title="Move up (Alt+↑)" onclick="event.stopPropagation();moveBlock(this.closest('.page-block'),'up')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 15-6-6-6 6"/></svg>
      </button>
      <button class="icon-btn" title="Move down (Alt+↓)" onclick="event.stopPropagation();moveBlock(this.closest('.page-block'),'down')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <button class="icon-btn" title="Duplicate" onclick="event.stopPropagation();duplicateBlock(this.closest('.page-block'))">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
      <button class="icon-btn danger" title="Delete (Ctrl+Del)" onclick="event.stopPropagation();deleteBlock(this.closest('.page-block'))">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>

    <div class="block-canvas" style="position:relative;min-height:${MIN_BLOCK_H}px;padding:24px;"></div>

    <div class="block-resize-handle" title="Drag to set block height" aria-hidden="true"></div>
  `;

  // Click block background → select block
  article.addEventListener('click', (e) => {
    if (e.target === article || e.target.classList.contains('block-canvas')) {
      selectBlock(article);
    }
  });

  article.addEventListener('keydown', (e) => blockKeydown(e, article));

  // Block resize handle
  const resizeBar = article.querySelector('.block-resize-handle');
  resizeBar.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const bc = article.querySelector('.block-canvas');
    _blockResize = {
      blockEl:    article,
      startMouseY: e.clientY,
      startH:      bc.offsetHeight,
    };
    isResizingBlock = true;
  });

  // Double-click resize handle resets to auto height
  resizeBar.addEventListener('dblclick', () => {
    delete article.dataset.fixedHeight;
    article.querySelector('.block-canvas').style.minHeight = '';
    recalcBlockHeight(article);
  });

  // Drag handle for block reordering
  const handle = article.querySelector('.drag-handle');
  handle.addEventListener('mousedown', () => article.setAttribute('draggable', 'true'));

  // Populate with default elements or restored ones
  const bc = article.querySelector('.block-canvas');
  if (elements && elements.length) {
    elements.forEach(eData => {
      const elEl = makeElementEl(eData.type, eData.x, eData.y, eData.w);
      // Restore styles
      if (eData.style) {
        const inner = elEl.querySelector('.el-inner') || elEl;
        if (eData.style.fontSize)   inner.style.fontSize   = eData.style.fontSize;
        if (eData.style.fontWeight) inner.style.fontWeight  = eData.style.fontWeight;
        if (eData.style.color)      inner.style.color       = eData.style.color;
      }
      if (eData.padding) {
        elEl.style.paddingTop    = eData.padding.top    || '';
        elEl.style.paddingRight  = eData.padding.right  || '';
        elEl.style.paddingBottom = eData.padding.bottom || '';
        elEl.style.paddingLeft   = eData.padding.left   || '';
      }
      if (eData.margin) {
        elEl.style.marginTop    = eData.margin.top    || '';
        elEl.style.marginRight  = eData.margin.right  || '';
        elEl.style.marginBottom = eData.margin.bottom || '';
        elEl.style.marginLeft   = eData.margin.left   || '';
      }
      if (eData.zIndex)  elEl.style.zIndex  = eData.zIndex;
      if (eData.href)    elEl.dataset.href   = eData.href;
      if (eData.content) {
        const inner = elEl.querySelector('.el-inner');
        if (inner && inner.getAttribute('contenteditable')) inner.innerHTML = eData.content;
      }
      if (eData.fixedH) elEl.style.height = eData.fixedH;
      bc.appendChild(elEl);
    });
  } else {
    // Default first element matching block type
    const defaultType = type === 'hero' ? 'heading' : type === 'divider' ? 'divider' : 'text';
    const elEl = makeElementEl(defaultType, 5, 10, 90);
    bc.appendChild(elEl);
  }

  setTimeout(() => recalcBlockHeight(article), 0);

  return article;
}

// ── Block drag-and-drop (block reordering) ────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  canvas.addEventListener('dragstart', (e) => {
    const block = e.target.closest('.page-block');
    if (!block) return;
    block._isDragging = true;
    block.style.opacity = '0.4';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
  });

  canvas.addEventListener('dragover',  (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
  canvas.addEventListener('dragenter', (e) => { const dz = e.target.closest('.drop-zone'); if (dz) dz.classList.add('over'); });
  canvas.addEventListener('dragleave', (e) => { const dz = e.target.closest('.drop-zone'); if (dz && !dz.contains(e.relatedTarget)) dz.classList.remove('over'); });

  canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    const dz    = e.target.closest('.drop-zone');
    const block = canvas.querySelector('.page-block[style*="opacity"]');
    if (!dz || !block) return;
    dz.classList.remove('over');
    dz.after(block);
    block.before(makeDropZone());
    markUnsaved();
  });

  canvas.addEventListener('dragend', (e) => {
    const block = e.target.closest('.page-block');
    if (block) block.style.opacity = '';
    canvas.querySelectorAll('.drop-zone').forEach(dz => dz.classList.remove('over'));
  });
});

// ── Public block operations ───────────────────────────────────────────────────

window.addBlock = function addBlock(type) {
  const block = makeBlockEl(type);
  canvas.appendChild(makeDropZone());
  canvas.appendChild(block);
  canvas.appendChild(makeDropZone());
  selectBlock(block);
  block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  markUnsaved();
  announce(type + ' block added');
};

window.deleteBlock = function deleteBlock(el) {
  const type = el.dataset.blockType || 'block';
  const btn  = el.querySelector('.block-toolbar button.danger');

  if (!btn._confirming) {
    btn._confirming = true;
    const original  = btn.innerHTML;
    btn.innerHTML   = 'Sure?';
    btn.style.width = 'auto';
    btn.style.padding = '4px 8px';
    btn.style.fontSize = '11px';

    // Reset if user clicks away
    const reset = () => {
      btn._confirming   = false;
      btn.innerHTML     = original;
      btn.style.width   = '';
      btn.style.padding = '';
      btn.style.fontSize = '';
      document.removeEventListener('click', reset);
    };
    setTimeout(() => document.addEventListener('click', reset), 0);
    return;
  }

  const prev = el.previousElementSibling;
  if (prev?.classList.contains('drop-zone')) prev.remove();
  el.remove();

  selectedBlock = null;
  showEmptyInspector();
  markUnsaved();
  announce(type + ' block deleted');
};

window.duplicateBlock = function duplicateBlock(el) {
  const data  = serializeBlock(el);
  const clone = makeBlockEl(data.type, data.elements);
  clone.style.background = el.style.background || '';
  el.after(clone, makeDropZone());
  selectBlock(clone);
  markUnsaved();
  announce(el.dataset.blockType + ' block duplicated');
};



window.moveBlock = function moveBlock(el, dir) {
  const blocks = [...canvas.querySelectorAll('.page-block')];
  const idx    = blocks.indexOf(el);

  if (dir === 'up' && idx > 0) {
    const target = blocks[idx - 1];
    const dz = makeDropZone();
    canvas.insertBefore(dz, target);
    canvas.insertBefore(el, dz);
    cleanDropZones();
    announce('Block moved up');

  } else if (dir === 'down' && idx < blocks.length - 1) {
    const target = blocks[idx + 1];
    const dz = makeDropZone();
    const afterTarget = target.nextElementSibling;
    canvas.insertBefore(el,  afterTarget ?? null);
    canvas.insertBefore(dz,  afterTarget ?? null);
    cleanDropZones();
    announce('Block moved down');
  }

  markUnsaved();
};

function cleanDropZones() {
  [...canvas.children].forEach((child, i, arr) => {
    if (child.classList.contains('drop-zone')) {
      if (arr[i + 1]?.classList.contains('drop-zone')) child.remove();
    }
  });
}

window.blockKeydown = function blockKeydown(e, el) {
  if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); selectBlock(el); }
  if (e.altKey && e.key === 'ArrowUp')   { e.preventDefault(); moveBlock(el, 'up'); }
  if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); moveBlock(el, 'down'); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Delete') { e.preventDefault(); deleteBlock(el); }
};

// ── Image upload ──────────────────────────────────────────────────────────────

window.triggerImageUpload = function triggerImageUpload(placeholder) {
  const input  = document.createElement('input');
  input.type   = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = document.createElement('img');
    img.src   = url;
    img.alt   = file.name.replace(/\.[^.]+$/, '');
    img.style.cssText = 'max-width:100%;border-radius:var(--radius);display:block;';
    placeholder.replaceWith(img);
    markUnsaved();
  });
  input.click();
};

// ── Serialization ─────────────────────────────────────────────────────────────

function serializeBlock(blockEl) {
  const bc       = blockEl.querySelector('.block-canvas');
  const elements = [...bc.querySelectorAll('.block-element')].map(el => {
    const inner = el.querySelector('.el-inner');
    return {
      type:    el.dataset.elType,
      x:       parseFloat(el.style.left)  || 0,
      y:       parseFloat(el.style.top)   || 0,
      w:       parseFloat(el.style.width) || 40,
      zIndex:  el.style.zIndex || '1',
      href:    el.dataset.href || null,
      content: inner?.getAttribute('contenteditable') ? inner.innerHTML.trim() : null,
      fixedH:  el.style.height || null,
      style: {
        fontSize:   inner?.style.fontSize   || null,
        fontWeight: inner?.style.fontWeight || null,
        color:      inner?.style.color      || null,
      },
      padding: {
        top:    el.style.paddingTop    || null,
        right:  el.style.paddingRight  || null,
        bottom: el.style.paddingBottom || null,
        left:   el.style.paddingLeft   || null,
      },
      margin: {
        top:    el.style.marginTop    || null,
        right:  el.style.marginRight  || null,
        bottom: el.style.marginBottom || null,
        left:   el.style.marginLeft   || null,
      },
    };
  });

  return {
    type:        blockEl.dataset.blockType,
    id:          blockEl.id || null,
    background:  blockEl.style.background || null,
    padding:     blockEl.dataset.padding  || '24px',
    fixedHeight: blockEl.dataset.fixedHeight || null,
    elements,
  };
}

window.serializePage = function serializePage() {
  const blocks = [...canvas.querySelectorAll('.page-block')].map(serializeBlock);
  return {
    title:   pageTitleInput ? pageTitleInput.value.trim() : '',
    blocks,
    savedAt: new Date().toISOString(),
  };
};

// ── Load page from API data ───────────────────────────────────────────────────

window.Editor = {
  loadPage(page) {
    if (!canvas) return;
    canvas.innerHTML = '';
    canvas.appendChild(makeDropZone());

    (page.blocks || []).forEach(bData => {
      const block = makeBlockEl(bData.type, bData.elements || []);
      if (bData.id)          block.id                = bData.id;
      if (bData.background)  block.style.background  = bData.background;
      if (bData.fixedHeight) {
        block.dataset.fixedHeight = bData.fixedHeight;
        block.querySelector('.block-canvas').style.minHeight = bData.fixedHeight + 'px';
      }
      canvas.appendChild(block);
      canvas.appendChild(makeDropZone());
    });

    const first = canvas.querySelector('.page-block');
    if (first) selectBlock(first);
  }
};

// ── Utility ───────────────────────────────────────────────────────────────────

function rgbToHex(rgb) {
  if (!rgb || rgb.startsWith('#')) return rgb || '';
  const m = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (!m) return '';
  return '#' + [m[1], m[2], m[3]].map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
}

function showToast(msg) {
  if (typeof window.showToast === 'function') { window.showToast(msg); return; }
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}