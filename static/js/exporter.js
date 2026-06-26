/**
 * preview.js — MakerThing live preview module
 *
 * Responsibilities:
 *  - Render current editor state into a sandboxed iframe panel
 *  - Open a new tab pointing at /preview/<id> for full-page preview
 *  - Exposed globals: previewPage(), togglePreviewPanel()
 *
 * Two preview modes:
 *  1. Panel preview  — inline iframe that slides in from the right,
 *                      re-rendered from live editor state (no server round-trip)
 *  2. Tab preview    — opens /preview/<id> in a new tab using saved server data
 */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

let previewPanel  = null;   // the iframe overlay element
let previewIframe = null;   // the <iframe> inside it
let panelOpen     = false;

// ── Primary entry point (called by topbar Preview button) ─────────────────────

/**
 * previewPage()
 * If there's a saved page ID, opens a new tab at /preview/<id>.
 * Otherwise falls back to the inline panel so the user can preview
 * unsaved work without a server round-trip.
 */
window.previewPage = function previewPage() {
  if (App.currentPageId && !App.isDirty) {
    window.open('/preview/' + App.currentPageId, '_blank', 'noopener');
  } else {
    // Unsaved content — use inline panel
    openPreviewPanel();
  }
};

// ── Inline panel preview ──────────────────────────────────────────────────────

window.togglePreviewPanel = function togglePreviewPanel() {
  if (panelOpen) closePreviewPanel();
  else           openPreviewPanel();
};

function openPreviewPanel() {
  ensurePanel();
  renderIntoPanel();
  previewPanel.classList.add('open');
  panelOpen = true;
  document.getElementById('preview-panel-btn')?.setAttribute('aria-pressed', 'true');
}

function closePreviewPanel() {
  if (previewPanel) previewPanel.classList.remove('open');
  panelOpen = false;
  document.getElementById('preview-panel-btn')?.setAttribute('aria-pressed', 'false');
}

function ensurePanel() {
  if (previewPanel) return;

  previewPanel = document.createElement('div');
  previewPanel.id        = 'preview-panel';
  previewPanel.setAttribute('role', 'dialog');
  previewPanel.setAttribute('aria-label', 'Page preview');
  previewPanel.innerHTML = `
    <div class="preview-panel-header">
      <span style="font-size:13px;font-weight:600;color:var(--text-muted);">Preview</span>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="ghost icon-btn" id="preview-refresh-btn"
                onclick="renderIntoPanel()" aria-label="Refresh preview" title="Refresh">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
        <button class="ghost icon-btn" onclick="closePreviewPanel()" aria-label="Close preview" title="Close">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
    <iframe id="preview-iframe" title="Page preview" sandbox="allow-same-origin"></iframe>
  `;

  document.body.appendChild(previewPanel);
  previewIframe = document.getElementById('preview-iframe');

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelOpen) closePreviewPanel();
  });

  injectPanelStyles();
}

function renderIntoPanel() {
  if (!previewIframe) return;

  const pageData = typeof serializePage === 'function'
    ? serializePage()
    : { title: '', blocks: [] };

  const html = buildPreviewHtml(pageData);

  // Write into iframe via srcdoc for sandboxing
  previewIframe.srcdoc = html;
}

// ── HTML builder (reuses exporter logic, lighter styles) ─────────────────────

function buildPreviewHtml(pageData) {
  const blocksHtml = (pageData.blocks || []).map(renderBlockToPreviewHtml).join('\n');
  const title      = escapeHtml(pageData.title || 'Preview');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
${PREVIEW_CSS}
</style>
</head>
<body>
<main class="page-root">
${blocksHtml}
</main>
</body>
</html>`;
}

function renderBlockToPreviewHtml(block) {
  const bg      = block.background  ? `background:${escapeAttr(block.background)};` : '';
  const padding  = block.padding    ? `padding:${escapeAttr(block.padding)};`        : '';
  const minH     = block.fixedHeight? `min-height:${escapeAttr(block.fixedHeight)}px;` : '';
  const id       = block.id         ? ` id="${escapeAttr(block.id)}"`                : '';
  const elements = (block.elements || []).map(renderElementToPreviewHtml).join('\n');

  return `<section class="block"${id} style="${bg}">
  <div class="block-canvas" style="${padding}${minH}position:relative;">
    ${elements}
  </div>
</section>`;
}

function renderElementToPreviewHtml(el) {
  const left   = el.x    != null ? `left:${el.x}%;`        : '';
  const top    = el.y    != null ? `top:${el.y}px;`        : '';
  const width  = el.w    != null ? `width:${el.w}%;`       : '';
  const zIndex = el.zIndex       ? `z-index:${el.zIndex};` : '';
  const fixedH = el.fixedH       ? `height:${escapeAttr(el.fixedH)};` : '';

  const pad = joinStyle({
    'padding-top':    el.padding?.top,
    'padding-right':  el.padding?.right,
    'padding-bottom': el.padding?.bottom,
    'padding-left':   el.padding?.left,
  });
  const mar = joinStyle({
    'margin-top':    el.margin?.top,
    'margin-right':  el.margin?.right,
    'margin-bottom': el.margin?.bottom,
    'margin-left':   el.margin?.left,
  });

  const posStyle   = `position:absolute;${left}${top}${width}${zIndex}${fixedH}${pad}${mar}`;
  const innerStyle = joinStyle({
    'font-size':   el.style?.fontSize,
    'font-weight': el.style?.fontWeight,
    'color':       el.style?.color,
  });

  const inner = renderInnerPreviewHtml(el, innerStyle);
  return `<div class="el el-${escapeAttr(el.type || 'text')}" style="${posStyle}">${inner}</div>`;
}

function renderInnerPreviewHtml(el, innerStyle) {
  const s    = innerStyle ? ` style="${innerStyle}"` : '';
  const href = el.href ? escapeAttr(el.href) : '#';

  switch (el.type) {
    case 'heading':
      return `<h2${s}>${el.content || ''}</h2>`;
    case 'image':
      if (el.content && el.content.startsWith('<img')) return el.content;
      return `<div class="img-placeholder">Image</div>`;
    case 'button':
      return `<a href="${href}" class="btn"${s}>${el.content || 'Button'}</a>`;
    case 'divider':
      return `<hr${s}>`;
    case 'text':
    default:
      return `<p${s}>${el.content || ''}</p>`;
  }
}

// ── Preview CSS ───────────────────────────────────────────────────────────────

const PREVIEW_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 15px; color: #1a1917; background: #f5f4f1;
  padding: 24px 16px;
}
.page-root { max-width: 760px; margin: 0 auto; }
.block { background: #ffffff; border-radius: 12px; margin-bottom: 12px; }
.block-canvas { position: relative; padding: 24px; min-height: 80px; }
.el { position: absolute; }
.el p  { font-size: 15px; line-height: 1.7; }
.el h2 { font-size: 26px; font-weight: 700; letter-spacing: -0.3px; line-height: 1.2; }
.el hr { border: none; border-top: 1px solid #e0ddd6; }
.btn {
  display: inline-block; padding: 8px 18px;
  background: #3b6d11; color: #fff; border-radius: 6px;
  font-weight: 500; font-size: 14px; text-decoration: none;
}
.btn:hover { background: #27500a; }
img { max-width: 100%; border-radius: 8px; display: block; }
.img-placeholder {
  border: 2px dashed #c8c5bc; border-radius: 8px;
  padding: 24px; color: #999; font-size: 12px; text-align: center;
}
@media (prefers-color-scheme: dark) {
  body { background: #1c1b18; color: #f0ede6; }
  .block { background: #252420; }
  .el hr { border-color: #38362f; }
}
@media (max-width: 500px) {
  .el { position: static !important; width: 100% !important; margin-bottom: 12px; }
  .block-canvas { min-height: unset !important; }
}
`.trim();

// ── Panel styles (injected once into the editor page) ─────────────────────────

function injectPanelStyles() {
  if (document.getElementById('preview-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'preview-panel-styles';
  style.textContent = `
    #preview-panel {
      position: fixed; top: 0; right: -520px; width: 500px; height: 100vh;
      background: var(--surface); border-left: 1px solid var(--border);
      display: flex; flex-direction: column;
      z-index: 500; transition: right 0.25s ease;
      box-shadow: -4px 0 24px rgba(0,0,0,0.12);
    }
    #preview-panel.open { right: 0; }
    .preview-panel-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    #preview-iframe { flex: 1; border: none; background: #f5f4f1; }
  `;
  document.head.appendChild(style);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function joinStyle(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:${v}`)
    .join(';') + (Object.values(obj).some(Boolean) ? ';' : '');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

// Expose closePreviewPanel for the close button inside the panel
window.closePreviewPanel = closePreviewPanel;
window.renderIntoPanel   = renderIntoPanel;