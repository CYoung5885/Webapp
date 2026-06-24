/**
 * exporter.js — MakerThing export module
 *
 * Responsibilities:
 *  - Trigger server-side HTML export download
 *  - Client-side fallback export (inline blob)
 *  - Exposed globals: exportPage()
 */

'use strict';

// ── Server-side export (primary) ──────────────────────────────────────────────

/**
 * exportPage()
 * Called by the Export button. Hits /api/pages/<id>/export which returns
 * a complete standalone HTML file as an attachment.
 */
window.exportPage = async function exportPage() {
  if (!App.currentPageId) {
    showToastError('No page loaded to export.');
    return;
  }

  // Save first so the export reflects latest content
  if (App.isDirty) {
    await savePage();
  }

  try {
    const response = await fetch(`/api/pages/${App.currentPageId}/export`);

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const blob     = await response.blob();
    const filename = getFilenameFromResponse(response) || 'page.html';
    triggerDownload(blob, filename);

    showToast('Export downloaded');

  } catch (err) {
    console.warn('[Exporter] Server export failed, falling back to client export.', err);
    clientExport();
  }
};

// ── Client-side fallback export ───────────────────────────────────────────────

/**
 * clientExport()
 * Builds a standalone HTML file from the current editor state without
 * hitting the server. Used as fallback if the server export fails.
 */
function clientExport() {
  const pageData = typeof serializePage === 'function'
    ? serializePage()
    : { title: 'Export', blocks: [] };

  const html = buildStandaloneHtml(pageData);
  const blob = new Blob([html], { type: 'text/html' });
  const name = slugify(pageData.title || 'page') + '.html';
  triggerDownload(blob, name);
  showToast('Export downloaded (client)');
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function buildStandaloneHtml(pageData) {
  const blocksHtml = (pageData.blocks || []).map(renderBlockToHtml).join('\n');
  const title      = escapeHtml(pageData.title || 'Exported Page');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
${EXPORT_CSS}
</style>
</head>
<body>
<main class="page-root">
${blocksHtml}
</main>
</body>
</html>`;
}

function renderBlockToHtml(block) {
  const bg      = block.background ? `background:${escapeAttr(block.background)};` : '';
  const padding = block.padding    ? `padding:${escapeAttr(block.padding)};`        : '';
  const minH    = block.fixedHeight? `min-height:${escapeAttr(block.fixedHeight)}px;` : '';
  const id      = block.id         ? ` id="${escapeAttr(block.id)}"`                : '';

  const elementsHtml = (block.elements || []).map(renderElementToHtml).join('\n');

  return `<section class="block"${id} style="${bg}">
  <div class="block-canvas" style="${padding}${minH}position:relative;">
    ${elementsHtml}
  </div>
</section>`;
}

function renderElementToHtml(el) {
  const left    = el.x        != null ? `left:${el.x}%;`       : '';
  const top     = el.y        != null ? `top:${el.y}px;`       : '';
  const width   = el.w        != null ? `width:${el.w}%;`      : '';
  const zIndex  = el.zIndex             ? `z-index:${el.zIndex};` : '';
  const fixedH  = el.fixedH            ? `height:${escapeAttr(el.fixedH)};` : '';

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

  const posStyle = `position:absolute;${left}${top}${width}${zIndex}${fixedH}${pad}${mar}`;

  const innerStyle = joinStyle({
    'font-size':   el.style?.fontSize,
    'font-weight': el.style?.fontWeight,
    'color':       el.style?.color,
  });

  const inner = renderInnerHtml(el, innerStyle);
  return `<div class="el el-${escapeAttr(el.type || 'text')}" style="${posStyle}">${inner}</div>`;
}

function renderInnerHtml(el, innerStyle) {
  const s    = innerStyle ? ` style="${innerStyle}"` : '';
  const href = el.href ? escapeAttr(el.href) : '#';

  switch (el.type) {
    case 'heading':
      return `<h2${s}>${el.content || ''}</h2>`;

    case 'image':
      // If content is an img tag (from upload), preserve it; else show placeholder text
      if (el.content && el.content.startsWith('<img')) return el.content;
      return `<p style="color:#999;font-size:13px;">[Image]</p>`;

    case 'button':
      return `<a href="${href}" class="btn"${s}>${el.content || 'Button'}</a>`;

    case 'divider':
      return `<hr${s}>`;

    case 'text':
    default:
      return `<p${s}>${el.content || ''}</p>`;
  }
}

// ── Export CSS (embedded in the downloaded file) ──────────────────────────────

const EXPORT_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 15px; color: #1a1917; background: #f5f4f1;
}
.page-root { max-width: 760px; margin: 0 auto; padding: 32px 16px; }
.block {
  background: #ffffff; border-radius: 12px;
  margin-bottom: 12px; overflow: visible;
}
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

@media (prefers-color-scheme: dark) {
  body { background: #1c1b18; color: #f0ede6; }
  .block { background: #252420; }
  .el hr { border-color: #38362f; }
}
@media (max-width: 600px) {
  .el { position: static !important; width: 100% !important; margin-bottom: 12px; }
  .block-canvas { min-height: unset !important; }
}
`.trim();

// ── Utilities ─────────────────────────────────────────────────────────────────

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

function getFilenameFromResponse(response) {
  const cd = response.headers.get('Content-Disposition') || '';
  const m  = cd.match(/filename="?([^"]+)"?/);
  return m ? m[1] : null;
}

function joinStyle(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:${v}`)
    .join(';') + (Object.values(obj).some(Boolean) ? ';' : '');
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function showToastError(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = '⚠ ' + msg;
  t.style.background = 'var(--danger)';
  t.classList.add('show');
  setTimeout(() => { t.classList.remove('show'); t.style.background = ''; }, 3500);
}