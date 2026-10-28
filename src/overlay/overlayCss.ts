/**
 * The review overlay's stylesheet.
 *
 * It is injected into a shadow root rather than the page, which is the whole
 * reason the overlay can be this short. A published page carries harvested
 * Obsidian CSS -- thousands of rules written against generic element and
 * class names -- and an overlay in the light DOM would inherit all of it. In
 * a shadow root nothing reaches in, so these rules are the only ones in play
 * and none of them can reach back out and change the page being reviewed.
 *
 * Theme comes from a `data-theme` attribute this script sets on the shadow
 * wrapper, copied from the one the page already sets on `<html>`. A shadow
 * root cannot select its host document's attributes, and `prefers-color-scheme`
 * would ignore the reader's own choice.
 */
export const OVERLAY_CSS = `
:host { all: initial; }

.osp-overlay {
  --co-bg: #ffffff;
  --co-fg: #1f2328;
  --co-dim: #59636e;
  --co-line: #d1d9e0;
  --co-accent: #0969da;
  --co-pin: #bc4c00;
  --co-done: #1a7f37;
  --co-shadow: 0 1px 3px rgba(31, 35, 40, 0.12), 0 8px 24px rgba(31, 35, 40, 0.12);
  font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: var(--co-fg);
}

.osp-overlay[data-theme="dark"] {
  --co-bg: #151b23;
  --co-fg: #d1d7e0;
  --co-dim: #9198a1;
  --co-line: #3d444d;
  --co-accent: #4493f8;
  --co-pin: #fd8c73;
  --co-done: #3fb950;
  --co-shadow: 0 1px 3px rgba(1, 4, 9, 0.4), 0 8px 24px rgba(1, 4, 9, 0.5);
}

.osp-overlay button {
  font: inherit;
  color: inherit;
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--co-line);
  border-radius: 6px;
  padding: 4px 10px;
}
.osp-overlay button:hover { border-color: var(--co-accent); color: var(--co-accent); }
.osp-overlay button[data-primary] {
  background: var(--co-accent);
  border-color: var(--co-accent);
  color: #fff;
}
.osp-overlay button[data-primary]:hover { opacity: 0.9; color: #fff; }
.osp-overlay button:disabled { opacity: 0.5; cursor: default; }

/* --- the launcher ---------------------------------------------------- */

.osp-overlay .co-launch {
  position: fixed;
  right: 16px;
  bottom: 16px;
  pointer-events: auto;
  background: var(--co-bg);
  box-shadow: var(--co-shadow);
  border-radius: 999px;
  padding: 7px 14px;
  display: flex;
  align-items: center;
  gap: 7px;
}
.osp-overlay .co-launch[hidden] { display: none; }
.osp-overlay .co-count {
  background: var(--co-pin);
  color: #fff;
  border-radius: 999px;
  min-width: 17px;
  height: 17px;
  font-size: 11px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}
.osp-overlay .co-count[hidden] { display: none; }

/* --- the panel ------------------------------------------------------- */

.osp-overlay .co-panel {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: 310px;
  max-height: min(70vh, 560px);
  pointer-events: auto;
  background: var(--co-bg);
  border: 1px solid var(--co-line);
  border-radius: 10px;
  box-shadow: var(--co-shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.osp-overlay .co-panel[hidden] { display: none; }

.osp-overlay .co-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--co-line);
}
.osp-overlay .co-title { font-weight: 600; flex: 1; }
.osp-overlay .co-foot {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--co-line);
}
.osp-overlay .co-foot > :first-child { flex: 1; }

.osp-overlay .co-list { overflow-y: auto; padding: 4px 0; flex: 1; }
.osp-overlay .co-empty { padding: 18px 14px; color: var(--co-dim); }

.osp-overlay .co-item {
  display: flex;
  gap: 9px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--co-line);
  align-items: flex-start;
}
.osp-overlay .co-item:last-child { border-bottom: 0; }
.osp-overlay .co-item[data-resolved] { opacity: 0.55; }
.osp-overlay .co-item[data-resolved] .co-text { text-decoration: line-through; }

.osp-overlay .co-badge {
  flex: none;
  width: 19px;
  height: 19px;
  border-radius: 999px;
  background: var(--co-pin);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 0;
  padding: 0;
}
.osp-overlay .co-item[data-resolved] .co-badge { background: var(--co-done); }
.osp-overlay .co-item[data-orphan] .co-badge { background: var(--co-dim); }

.osp-overlay .co-body { min-width: 0; flex: 1; }
.osp-overlay .co-text { white-space: pre-wrap; overflow-wrap: break-word; }
.osp-overlay .co-meta { color: var(--co-dim); font-size: 11px; margin-top: 3px; }
.osp-overlay .co-quote {
  color: var(--co-dim);
  font-size: 11px;
  border-left: 2px solid var(--co-line);
  padding-left: 6px;
  margin-top: 4px;
  overflow-wrap: break-word;
}
.osp-overlay .co-warn { color: var(--co-pin); font-size: 11px; margin-top: 3px; }
.osp-overlay .co-tools { display: flex; gap: 6px; margin-top: 6px; }
.osp-overlay .co-tools button { padding: 1px 7px; font-size: 11px; }

/* --- pins ------------------------------------------------------------ */

.osp-overlay .co-pins { position: absolute; top: 0; left: 0; }

.osp-overlay .co-pin {
  position: absolute;
  width: 21px;
  height: 21px;
  border-radius: 999px 999px 999px 2px;
  background: var(--co-pin);
  color: #fff;
  border: 0;
  padding: 0;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  box-shadow: var(--co-shadow);
}
.osp-overlay .co-pin[data-resolved] { background: var(--co-done); }

/* --- the draft popover ----------------------------------------------- */

.osp-overlay .co-draft {
  position: absolute;
  width: 272px;
  pointer-events: auto;
  background: var(--co-bg);
  border: 1px solid var(--co-line);
  border-radius: 10px;
  box-shadow: var(--co-shadow);
  padding: 10px;
}
.osp-overlay .co-draft[hidden] { display: none; }
.osp-overlay .co-draft textarea {
  font: inherit;
  color: inherit;
  width: 100%;
  box-sizing: border-box;
  min-height: 66px;
  resize: vertical;
  background: transparent;
  border: 1px solid var(--co-line);
  border-radius: 6px;
  padding: 6px 7px;
}
.osp-overlay .co-draft textarea:focus { outline: 2px solid var(--co-accent); outline-offset: -1px; }
.osp-overlay .co-draft-quote {
  color: var(--co-dim);
  font-size: 11px;
  margin-bottom: 7px;
  overflow-wrap: break-word;
}
.osp-overlay .co-draft-tools { display: flex; gap: 7px; margin-top: 8px; }
.osp-overlay .co-draft-tools > :first-child { flex: 1; }
.osp-overlay .co-hint { color: var(--co-dim); font-size: 11px; margin-top: 6px; }
`;
