let injected = false;

export function ensureOverlayStyles(): void {
  if (injected) return;
  const style = document.createElement('style');
  style.id = 'aiaf-overlay-styles';
  style.textContent = `
  /* Overlay root */
  .aiaf-overlay-root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }

  /* Floating Action Button */
  .aiaf-fab {
    position: fixed; right: 20px; bottom: 20px;
    width: 48px; height: 48px; border-radius: 24px;
    background: #2d6cdf; color: white; box-shadow: 0 6px 16px rgba(0,0,0,0.2);
    display: flex; align-items: center; justify-content: center;
    font-weight: 600; cursor: pointer; pointer-events: auto; user-select: none;
  }
  .aiaf-fab:hover { filter: brightness(1.05); }

  /* Preview Panel */
  .aiaf-panel { position: fixed; right: 20px; bottom: 80px; width: 320px; max-height: 60vh; overflow: auto;
    background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    pointer-events: auto; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, 'Noto Sans', Arial;
  }
  .aiaf-panel header { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; justify-content: space-between; }
  .aiaf-panel .body { padding: 8px 12px; }
  .aiaf-panel .row { display: grid; grid-template-columns: 1fr auto auto; gap: 6px; align-items: center; padding: 6px 0; border-bottom: 1px dashed #f5f5f5; }
  .aiaf-panel .row:last-child { border-bottom: none; }
  .aiaf-panel .key { font-weight: 600; font-size: 12px; color: #111827; }
  .aiaf-panel .target { font-size: 12px; color: #374151; }
  .aiaf-panel .score { font-size: 11px; color: #6b7280; }
  .aiaf-panel button { background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 6px; padding: 4px 8px; cursor: pointer; font-size: 12px; }
  .aiaf-panel button.primary { background: #2d6cdf; color: #fff; border-color: #2d6cdf; }
  .aiaf-panel footer { padding: 10px 12px; border-top: 1px solid #f0f0f0; display: flex; gap: 8px; justify-content: flex-end; }

  /* Field badges */
  .aiaf-badges { position: fixed; inset: 0; pointer-events: none; }
  .aiaf-badge { position: fixed; transform: translate(-100%, -100%); pointer-events: auto; font-size: 11px; padding: 2px 6px; border-radius: 999px; display: inline-flex; gap: 4px; align-items: center; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
  .aiaf-badge .dot { width: 8px; height: 8px; border-radius: 50%; }
  .aiaf-badge.pending { background: #fff7ed; color: #9a3412; border: 1px solid #fed7aa; }
  .aiaf-badge.pending .dot { background: #f59e0b; }
  .aiaf-badge.uncertain { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
  .aiaf-badge.uncertain .dot { background: #ef4444; }
  .aiaf-badge.filled { background: #f0fdf4; color: #14532d; border: 1px solid #bbf7d0; }
  .aiaf-badge.filled .dot { background: #22c55e; }

  /* Field highlighting */
  .aiaf-highlight-pending { outline: 2px solid rgba(245, 158, 11, 0.9); outline-offset: 2px; }
  .aiaf-highlight-uncertain { outline: 2px dashed rgba(239, 68, 68, 0.9); outline-offset: 2px; }
  .aiaf-highlight-filled { outline: 2px solid rgba(34, 197, 94, 0.9); outline-offset: 2px; }
  `;
  document.head.appendChild(style);
  injected = true;
}
