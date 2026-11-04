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
 * **The colour says what the mark means.** One hue carries the page: an open
 * mark is correction ink, and it is the only saturated thing drawn over the
 * reviewer's own content. Resolving a comment drains it to graphite, so a
 * page's remaining work is readable at a glance from the pins alone, without
 * opening anything.
 *
 * Priority has three hues of its own -- crimson, amber, blue -- and they are
 * chosen to be none of them that ink. Inside the overlay's own panels a
 * level is worth reading at a glance too, and the two questions must not
 * answer in the same colour: "still open" and "worth doing first" are
 * different things, and a comment can be either without being both. Colour
 * does those two jobs here and decorates nothing else.
 *
 * Theme comes from a `data-theme` attribute the script sets on the shadow
 * wrapper. There are two, light and dark, chosen by the reviewer and seeded
 * once from the page's own theme. The overlay's surfaces are deliberately
 * not the page's: a review tool that restyles itself to match the site being
 * reviewed stops being legible as a separate thing, and the point of the
 * preview is to look at the site, not at the tool.
 *
 * The pin's ink is the one value that does not change with the theme. A pin
 * is drawn over the page, not over the overlay, so it answers to the
 * reviewer's content rather than to this panel, and a mark that changed
 * colour with a setting would stop meaning one thing.
 */
export const OVERLAY_CSS = `
:host { all: initial; }

.osp-overlay {
  /* Correction ink. White on it is 4.57:1, so the numerals inside a pin
     clear AA on the one surface that is never the reviewer's to restyle. */
  --co-pin: #d4421e;
  --co-pin-soft: rgba(212, 66, 30, 0.1);
  --co-ink: #b3351a;
  --co-done: #6b7076;
  --co-bg: #ffffff;
  --co-bg-2: #f2f3f5;
  --co-fg: #15181c;
  --co-fg-2: #596069;
  --co-fg-3: #6e757d;
  --co-line: #e1e4e8;
  --co-danger: #8e1d10;

  /* The three priorities, each its own hue.
     Deliberately none of them the pin's vermilion: that one already means
     "open, not yet dealt with", and a priority wearing it would make a
     high-priority comment and an unresolved one the same colour. So high is
     a crimson rather than an orange-red, which is far enough from the number
     badge beside it in a panel row to be told apart at a glance. Each pill
     still carries its arrow as well, because a reader who cannot separate
     the hues has to be able to read the level anyway. */
  --co-pri-high-fg: #a3123f;
  --co-pri-high-bg: #fdeaf0;
  --co-pri-high-line: #f3bdd0;
  --co-pri-medium-fg: #7a4e00;
  --co-pri-medium-bg: #fdf2dc;
  --co-pri-medium-line: #efd9a4;
  --co-pri-low-fg: #1f5b7a;
  --co-pri-low-bg: #e6f2f8;
  --co-pri-low-line: #bbd9e9;

  /* The outline over the block the cursor is on. Quieter than the mark: it
     follows the pointer, and anything at full strength that moves with the
     pointer is a flicker rather than a hint. */
  --co-aim-line: rgba(212, 66, 30, 0.5);

  --co-r-1: 6px;
  --co-r-2: 8px;
  --co-r-3: 12px;

  --co-shadow:
    0 1px 2px rgba(16, 18, 22, 0.06),
    0 8px 24px -6px rgba(16, 18, 22, 0.18);
  --co-shadow-pin:
    drop-shadow(0 1px 1px rgba(0, 0, 0, 0.18))
    drop-shadow(0 3px 6px rgba(0, 0, 0, 0.16));

  /* Exponential ease-out: everything starts at speed and settles, which is
     what makes a 180ms transition read as instant rather than as animation. */
  --co-ease: cubic-bezier(0.22, 1, 0.36, 1);

  font: 13px/20px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: var(--co-fg);
}

.osp-overlay[data-theme="dark"] {
  --co-pin-soft: rgba(212, 66, 30, 0.18);
  --co-ink: #f2603a;
  --co-done: #7d858e;
  --co-bg: #16181c;
  --co-bg-2: #1e2126;
  --co-fg: #e6e9ed;
  --co-fg-2: #9ba3ac;
  --co-fg-3: #7d858e;
  --co-line: #2e333a;
  --co-aim-line: rgba(242, 96, 58, 0.55);
  /* The same three hues lightened for ink on a dark ground, over a wash of
     themselves rather than a solid: a saturated chip at this size glows on
     a dark panel, where the light theme's does not. */
  --co-pri-high-fg: #ff9ab8;
  --co-pri-high-bg: rgba(224, 37, 94, 0.16);
  --co-pri-high-line: rgba(224, 37, 94, 0.42);
  --co-pri-medium-fg: #f2c468;
  --co-pri-medium-bg: rgba(201, 146, 24, 0.16);
  --co-pri-medium-line: rgba(201, 146, 24, 0.42);
  --co-pri-low-fg: #8cc8e8;
  --co-pri-low-bg: rgba(56, 150, 200, 0.18);
  --co-pri-low-line: rgba(56, 150, 200, 0.45);
  --co-shadow:
    0 1px 2px rgba(0, 0, 0, 0.5),
    0 12px 32px -8px rgba(0, 0, 0, 0.6);
}

.osp-overlay * { box-sizing: border-box; margin: 0; padding: 0; }
.osp-overlay [hidden] { display: none !important; }
.osp-overlay button { font: inherit; cursor: pointer; }
.osp-overlay svg { flex: none; display: block; }

/* Numbers that sit in a fixed box have to be one width, or a pin reading 1
   and a pin reading 11 are optically off-centre from each other. */
.osp-overlay .co-num,
.osp-overlay .co-time,
.osp-overlay .co-pin span,
.osp-overlay .co-pop-pos,
.osp-overlay .co-filter b { font-variant-numeric: tabular-nums; }

/* --- the surfaces the browser draws ---------------------------------- */

/*
 * Selection, caret, focus ring and scrollbar all ship with defaults that
 * belong to no design system, and inside a shadow root they are ours to
 * set. Leaving them is the difference between a thing that was built and a
 * thing that was assembled.
 */
.osp-overlay ::selection { background: var(--co-pin-soft); color: var(--co-fg); }
.osp-overlay textarea,
.osp-overlay input { caret-color: var(--co-pin); }

.osp-overlay :focus-visible {
  outline: 2px solid var(--co-pin);
  outline-offset: 2px;
}
.osp-overlay textarea:focus-visible,
.osp-overlay .co-field:focus-visible { outline: none; }

.osp-overlay .co-list,
.osp-overlay .co-pop {
  scrollbar-width: thin;
  scrollbar-color: var(--co-line) transparent;
}
.osp-overlay .co-list::-webkit-scrollbar,
.osp-overlay .co-pop::-webkit-scrollbar { width: 10px; }
.osp-overlay .co-list::-webkit-scrollbar-track,
.osp-overlay .co-pop::-webkit-scrollbar-track { background: transparent; }
.osp-overlay .co-list::-webkit-scrollbar-thumb,
.osp-overlay .co-pop::-webkit-scrollbar-thumb {
  background: var(--co-line);
  border: 3px solid transparent;
  background-clip: content-box;
  border-radius: 999px;
}
.osp-overlay .co-list::-webkit-scrollbar-thumb:hover,
.osp-overlay .co-pop::-webkit-scrollbar-thumb:hover { background: var(--co-fg-3); background-clip: content-box; }

/* --- the notch -------------------------------------------------------- */

.osp-overlay .co-notch {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  pointer-events: auto;
  background: var(--co-bg);
  border: 1px solid var(--co-line);
  border-radius: 24px;
  box-shadow: var(--co-shadow);
  z-index: 1;
}

.osp-overlay .co-notch-btn {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--co-fg-2);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.osp-overlay .co-notch-btn:hover { background: var(--co-bg-2); color: var(--co-fg); }
.osp-overlay .co-notch-btn[data-open] { background: var(--co-bg-2); color: var(--co-fg); }

.osp-overlay .co-notch-div { width: 1px; height: 20px; background: var(--co-line); }

/* The three modes, as one control with a chip that slides between them --
   which is what makes them read as a choice of one rather than three
   independent toggles. */
.osp-overlay .co-modes {
  position: relative;
  display: flex;
  padding: 2px;
  border: 1px solid var(--co-line);
  border-radius: 16px;
  background: var(--co-bg-2);
}
.osp-overlay .co-mode-slider {
  position: absolute;
  top: 2px;
  left: 2px;
  width: calc(33.333% - 2px);
  height: calc(100% - 4px);
  background: var(--co-pin);
  border-radius: 14px;
  transition: transform 0.22s var(--co-ease);
  pointer-events: none;
}
.osp-overlay .co-mode-slider[data-at="1"] { transform: translateX(100%); }
.osp-overlay .co-mode-slider[data-at="2"] { transform: translateX(200%); }
/* Two stops, on a published build where commenting is off. The chip is
   sized from the number of modes rather than assuming three, or it would
   cover a third of a control with two buttons in it. */
.osp-overlay .co-modes[data-modes="2"] .co-mode-slider { width: calc(50% - 2px); }

.osp-overlay .co-mode {
  position: relative;
  z-index: 1;
  padding: 5px 10px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: var(--co-fg-2);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s;
}
.osp-overlay .co-mode[data-active] { color: #fff; }
.osp-overlay .co-mode:not([data-active]):hover { background: var(--co-bg); color: var(--co-fg); }

/* --- the notch menu --------------------------------------------------- */

.osp-overlay .co-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  min-width: 190px;
  padding: 4px;
  background: var(--co-bg);
  border: 1px solid var(--co-line);
  border-radius: var(--co-r-3);
  box-shadow: var(--co-shadow);
  animation: co-rise 0.16s var(--co-ease);
  z-index: 1;
}
.osp-overlay .co-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: var(--co-r-2);
  background: transparent;
  color: var(--co-fg);
  white-space: nowrap;
  text-align: left;
  transition: background 0.15s;
}
.osp-overlay .co-menu-item svg { color: var(--co-fg-2); }
.osp-overlay .co-menu-item:hover { background: var(--co-bg-2); }
.osp-overlay .co-menu-item:hover svg { color: var(--co-fg); }
/* Offered but not available, rather than missing: a row that disappears
   when there is nothing to export leaves the reviewer wondering whether
   exporting is a thing this does at all. */
.osp-overlay .co-menu-item[disabled] { color: var(--co-fg-3); cursor: default; }
.osp-overlay .co-menu-item[disabled] svg { opacity: 0.5; }
.osp-overlay .co-menu-item[disabled]:hover { background: transparent; }
.osp-overlay .co-menu-item[disabled]:hover svg { color: var(--co-fg-2); }
.osp-overlay .co-menu-rule { height: 1px; margin: 4px 0; background: var(--co-line); }
.osp-overlay .co-menu-key {
  margin-left: auto;
  padding-left: 16px;
  color: var(--co-fg-3);
  font-size: 11px;
}

/* --- pins ------------------------------------------------------------- */

/* The container sits at the document origin, so a pin's coordinates are
   document coordinates and scrolling moves nothing. */
.osp-overlay .co-pins { position: absolute; top: 0; left: 0; }

/*
 * The mark. A disc on a stem whose tip is the point that was clicked, drawn
 * with a ring in the overlay's own ground so it separates from whatever the
 * reviewer's page put underneath it -- body text, a photograph, a dark
 * callout. A pin that needs the page to be a particular colour to be
 * readable is a pin that fails on the page it was most needed.
 */
.osp-overlay .co-pin {
  position: absolute;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  background: transparent;
  pointer-events: auto;
  /* The sharp corner is at (5, 27) inside the box, so this puts that corner
     -- not the box, and not the tag's middle -- on the point that was
     clicked, and growing from the same origin drops it onto the point. */
  transform: translate(-5px, -27px);
  transform-origin: 5px 27px;
  filter: var(--co-shadow-pin);
  transition: filter 0.18s var(--co-ease);
  -webkit-user-select: none;
  user-select: none;
}
.osp-overlay .co-pin svg { position: absolute; inset: 0; width: 100%; height: 100%; }
/* The ring that holds the mark off the reviewer's own content. It lives
   here rather than on the element so it follows the theme. */
.osp-overlay .co-pin svg path { stroke: var(--co-bg); }
.osp-overlay .co-pin span {
  position: absolute;
  left: 5px;
  top: 3px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 12px;
  font-weight: 650;
  line-height: 1;
  letter-spacing: -0.01em;
  pointer-events: none;
}
.osp-overlay .co-pin:hover {
  filter:
    drop-shadow(0 1px 1px rgba(0, 0, 0, 0.2))
    drop-shadow(0 6px 12px rgba(0, 0, 0, 0.22));
}
.osp-overlay .co-pin[data-selected] { z-index: 2; }
.osp-overlay .co-pin:focus-visible { outline-offset: 1px; border-radius: 999px; }

/* The mark being written, before it is a comment. */
.osp-overlay .co-ghost { pointer-events: none; animation: co-pin-drop 0.24s var(--co-ease); }

@keyframes co-pin-drop {
  from { transform: translate(-5px, -33px) scale(0.4); opacity: 0; }
  to { transform: translate(-5px, -27px) scale(1); opacity: 1; }
}

@keyframes co-rise {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* --- the block under the cursor --------------------------------------- */

/*
 * Which block a click would mark. It sits at the document origin like the
 * pins, so it travels with the text and needs no scroll handler, and it is
 * drawn in here rather than on the page's own element so that nothing about
 * the article being reviewed is changed by looking at it.
 *
 * The transition is on the box itself, so moving between two paragraphs
 * glides rather than cuts -- which is what makes it read as one pointer
 * rather than as two separate highlights appearing.
 */
.osp-overlay .co-aim {
  position: absolute;
  pointer-events: none;
  border-radius: 5px;
  background: var(--co-pin-soft);
  box-shadow: inset 0 0 0 1.5px var(--co-aim-line);
  transition:
    left 0.12s var(--co-ease),
    top 0.12s var(--co-ease),
    width 0.12s var(--co-ease),
    height 0.12s var(--co-ease),
    box-shadow 0.12s var(--co-ease);
}
/* Chosen, not hovered. Firmer, because the decision has been made and the
   outline now says what the comment being written is about. */
.osp-overlay .co-aim[data-locked] {
  box-shadow: inset 0 0 0 2px var(--co-pin);
}

/* --- the capture layer ------------------------------------------------ */

/* Comment mode takes every click so that dropping a pin on a link does not
   also follow the link. The cursor carries the mode, so there is never a
   question of which one you are in. */
.osp-overlay .co-capture {
  position: fixed;
  inset: 0;
  pointer-events: auto;
  cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='29' height='29' viewBox='0 0 32 32'%3E%3Cpath d='M13 3 L21 3 A8 8 0 0 1 29 11 L29 19 A8 8 0 0 1 21 27 L5 27 L5 11 A8 8 0 0 1 13 3 Z' fill='%23d4421e' stroke='%23ffffff' stroke-width='5' stroke-linejoin='round' paint-order='stroke'/%3E%3Cpath d='M17 10v10M12 15h10' stroke='%23ffffff' stroke-width='2.4' stroke-linecap='round'/%3E%3C/svg%3E") 4 25, crosshair;
}

/* --- the side panel --------------------------------------------------- */

.osp-overlay .co-panel {
  position: fixed;
  top: 8px;
  height: calc(100vh - 16px);
  width: 320px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  pointer-events: auto;
  background: var(--co-bg);
  border: 1px solid var(--co-line);
  border-radius: var(--co-r-3);
  box-shadow: var(--co-shadow);
  font-size: 11px;
  z-index: 1;
}
.osp-overlay .co-panel[data-side="right"] {
  right: 8px;
  animation: co-slide-right 0.2s var(--co-ease);
}
.osp-overlay .co-panel[data-side="left"] {
  left: 8px;
  animation: co-slide-left 0.2s var(--co-ease);
}

@keyframes co-slide-right {
  from { opacity: 0; transform: translateX(12px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes co-slide-left {
  from { opacity: 0; transform: translateX(-12px); }
  to { opacity: 1; transform: translateX(0); }
}

.osp-overlay .co-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: ew-resize;
  background: transparent;
  transition: background 0.1s;
  z-index: 2;
}
.osp-overlay .co-panel[data-side="right"] .co-resizer { left: 0; }
.osp-overlay .co-panel[data-side="left"] .co-resizer { right: 0; }
.osp-overlay .co-resizer:hover,
.osp-overlay .co-resizer[data-dragging] { background: var(--co-pin); opacity: 0.3; }

/*
 * The head says how much work is left, not what the panel is called.
 *
 * It was a centred title reading "Review comments", which is a label for a
 * thing already on screen: by the time it can be read the reviewer has
 * opened the panel and knows what it is. The one question a review panel is
 * asked first is how much is still open, and the second is how old the
 * newest mark is, so those are the two lines, left-aligned and read as a
 * sentence rather than centred as a caption.
 *
 * The two buttons are taken out of the flow. Left in the row they shortened
 * every line beneath them, which clipped the end off the meta line; pinned
 * to the corner they shorten the first line only.
 */
.osp-overlay .co-panel-head {
  position: relative;
  flex: none;
  padding: 11px 8px 10px 16px;
  border-bottom: 1px solid var(--co-line);
}
.osp-overlay .co-panel-tally {
  padding-right: 56px;
  color: var(--co-fg);
  font-size: 14px;
  font-weight: 600;
  line-height: 18px;
  letter-spacing: -0.01em;
}
.osp-overlay .co-panel-meta {
  margin-top: 2px;
  color: var(--co-fg-3);
  font-size: 11px;
  line-height: 15px;
}
.osp-overlay .co-panel-acts {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 2px;
}

.osp-overlay .co-icon-btn {
  width: 24px;
  height: 24px;
  flex: none;
  border: 0;
  border-radius: var(--co-r-1);
  background: transparent;
  color: var(--co-fg-2);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s, color 0.12s;
}
.osp-overlay .co-icon-btn:hover { background: var(--co-bg-2); color: var(--co-fg); }

/* The filter and the order on one line. With a two-line head above it,
   a filter row and an order row of their own made three bands of chrome
   before the first comment.

   The margin underneath is the list's breathing space, held here rather
   than as padding on the list itself: see co-list for why a scroll
   container's top padding is a strip a sticky heading cannot cover. */
.osp-overlay .co-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  margin: 8px 8px 7px;
}

.osp-overlay .co-filters {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  padding: 2px;
  border: 1px solid var(--co-line);
  border-radius: 14px;
  background: var(--co-bg-2);
}
.osp-overlay .co-filter-slider {
  position: absolute;
  top: 2px;
  left: 2px;
  width: calc(33.333% - 2px);
  height: calc(100% - 4px);
  background: var(--co-pin);
  border-radius: 12px;
  transition: transform 0.22s var(--co-ease);
  pointer-events: none;
}
.osp-overlay .co-filter-slider[data-at="1"] { transform: translateX(100%); }
.osp-overlay .co-filter-slider[data-at="2"] { transform: translateX(200%); }
.osp-overlay .co-filter {
  position: relative;
  z-index: 1;
  flex: 1;
  padding: 4px 0;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--co-fg-2);
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  transition: color 0.15s;
}
/* The count rides inside the label, so the scope of a filter is readable
   before it is chosen rather than after. */
.osp-overlay .co-filter b { font-weight: 550; opacity: 0.75; }
.osp-overlay .co-filter[data-active] { color: #fff; }
.osp-overlay .co-filter[data-active] b { opacity: 0.85; }
.osp-overlay .co-filter:not([data-active]):hover { color: var(--co-fg); }

/*
 * The order the list is in: one chip on the end of the filter row.
 *
 * It has been three things. A small grey word right-aligned in a row of its
 * own, naming the order it would switch *to* -- unseen as a control, and
 * backwards once seen. Then a labelled pair built like the filter row, which
 * fixed both but cost a whole band of chrome, and once the head above it
 * grew to two lines that was three layers before the first comment.
 *
 * So: a chip, on the line the filters already own. It names the order in
 * force rather than the one it would switch to, and the arrows carry the
 * toggle. A bordered chip at the pill's own height reads as a control where
 * a bare word in an empty row did not, which was the original complaint.
 */
.osp-overlay .co-sort {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: none;
  padding: 4px 9px;
  border: 1px solid var(--co-line);
  border-radius: 14px;
  background: var(--co-bg-2);
  color: var(--co-fg-2);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
  transition: color 0.14s, border-color 0.14s;
}
.osp-overlay .co-sort:hover { color: var(--co-fg); border-color: var(--co-fg-3); }
.osp-overlay .co-sort svg { opacity: 0.7; }

/*
 * No padding at the top, deliberately.
 *
 * A sticky child is held inside the scroll container's *content* box, not
 * its padding box -- so with \`padding-top: 4px\` here, a heading asking for
 * \`top: 0\` came to rest 4px down, and rows scrolled past in the strip of
 * bare panel above it. The breathing space the padding gave the first
 * element belongs above the scroll container instead, as a margin under the
 * controls -- space nothing can scroll through, rather than space the list
 * owns and a stuck heading cannot cover.
 */
.osp-overlay .co-list { flex: 1; overflow-y: auto; padding: 0 0 8px; }

/*
 * The page a run of rows belongs to.
 *
 * Sticky, because the list is now long enough to scroll past the heading
 * that says which page the rows under the cursor are about -- which is the
 * one fact a grouped list must never make the reader scroll back for. The
 * page being read is named "This page" rather than by its filename: it is
 * the group that needs no identifying, and saying so is shorter than
 * saying which.
 */
.osp-overlay .co-group {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px 4px;
  background: var(--co-bg);
  color: var(--co-fg-3);
  font-size: 10px;
  font-weight: 550;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.osp-overlay .co-group[data-here] { color: var(--co-fg-2); }
.osp-overlay .co-group-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.osp-overlay .co-group-count {
  flex: none;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
}
/* The kind, as a glyph in front of the name: a file for a note, a window for
   a page that was published as it was found. Dimmer than the name, which is
   the part being read. */
.osp-overlay .co-group svg { opacity: 0.7; }

.osp-overlay .co-row { display: block; padding: 2px 8px; cursor: pointer; }
/* A row for another page is an anchor, so it arrives wearing the browser's
   link colour and underline. */
.osp-overlay a.co-row { color: inherit; text-decoration: none; }
.osp-overlay .co-row-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px;
  border-radius: var(--co-r-2);
  transition: background 0.12s;
}
.osp-overlay .co-row:hover .co-row-card { background: var(--co-bg-2); }
.osp-overlay .co-row[data-selected] .co-row-card { background: var(--co-pin-soft); }
.osp-overlay .co-row[data-resolved] .co-row-name strong {
  color: var(--co-fg-2);
  font-weight: 450;
}
.osp-overlay .co-row[data-resolved] .co-row-text { color: var(--co-fg-3); }

.osp-overlay .co-num {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--co-pin);
  color: #fff;
  font-size: 11px;
  font-weight: 650;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.osp-overlay .co-row[data-resolved] .co-num,
.osp-overlay .co-row[data-orphan] .co-num { background: var(--co-done); }

.osp-overlay .co-row-body { flex: 1; min-width: 0; }
.osp-overlay .co-row-name {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.osp-overlay .co-row-name strong {
  font-weight: 550;
  font-size: 13px;
  line-height: 22px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
/*
 * The pill on a comment no person typed. Deliberately not coloured: it is a
 * fact about where a comment came from, not a judgement about it, and the
 * one hue in here is spoken for.
 */
.osp-overlay .co-tag {
  flex: none;
  padding: 1px 6px;
  border: 1px solid var(--co-line);
  border-radius: 999px;
  background: var(--co-bg-2);
  color: var(--co-fg-2);
  font-size: 10px;
  font-weight: 550;
  line-height: 14px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

/*
 * The same pill carrying an issue number instead of a word, so it keeps the
 * number's own casing and is drawn in the ink: it is the one thing in a row
 * that leads somewhere off the page.
 */
.osp-overlay a.co-tag[data-ext] {
  color: var(--co-ink);
  text-transform: none;
  letter-spacing: 0;
  text-decoration: none;
}
.osp-overlay a.co-tag[data-ext]:hover { border-color: var(--co-ink); }

.osp-overlay .co-time { flex: none; white-space: nowrap; color: var(--co-fg-2); font-size: 11px; }
/* In a panel row the time goes to the far edge, so the dates line up in a
   column of their own instead of sitting wherever the name and the pills
   happen to end. It is the one thing in a row nobody reads on purpose. */
.osp-overlay .co-row-name .co-time { margin-left: auto; }

.osp-overlay .co-row-text {
  margin: 1px 0 0;
  color: var(--co-fg-2);
  font-size: 11px;
  line-height: 16px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
/*
 * The foot of a row: where the comment went, and what it is about.
 *
 * The priority spent a while down here, against the quote, and the issue
 * pill sat on the top line beside the name. They have swapped. The popup
 * puts the level in its title bar, at the top of the card, and a reviewer
 * moving between the list and the card should find the same fact in the
 * same place in both -- so the level goes up and the issue comes down,
 * where it is also out of the way of the name and the date.
 */
.osp-overlay .co-row-foot {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  margin-top: 5px;
}
/* One line here, whatever it is elsewhere: a row is a summary, and three
   lines of quoted prose in it would bury the comment above them. */
.osp-overlay .co-row-foot .co-quote {
  flex: 1;
  min-width: 0;
  margin-top: 0;
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.osp-overlay .co-row-meta { margin-top: 4px; color: var(--co-fg-3); font-size: 11px; }

.osp-overlay .co-quote {
  padding-left: 7px;
  border-left: 1px solid var(--co-line);
  color: var(--co-fg-2);
  font-size: 11px;
  line-height: 16px;
  overflow-wrap: break-word;
}
.osp-overlay .co-row .co-quote { margin-top: 5px; }
.osp-overlay .co-warn { color: var(--co-ink); font-size: 11px; line-height: 16px; }
.osp-overlay .co-row .co-warn { margin-top: 4px; }

.osp-overlay .co-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 48px 28px;
  text-align: center;
  color: var(--co-fg-2);
}
.osp-overlay .co-empty svg { color: var(--co-fg-3); opacity: 0.55; }
.osp-overlay .co-empty-title { color: var(--co-fg); font-size: 13px; font-weight: 550; }
.osp-overlay .co-empty-text { font-size: 11px; line-height: 17px; max-width: 24ch; }

/*
 * Which page a row is on, when the list is one flat queue and the headings
 * are not there to say it.
 *
 * Above the author rather than beside them: it is where the comment is, not
 * who wrote it, and a row whose first line answers "where" reads in the
 * order the question is asked.
 */
.osp-overlay .co-row-page {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 2px;
  color: var(--co-fg-3);
  font-size: 10px;
  line-height: 14px;
  min-width: 0;
}
.osp-overlay .co-row-page span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.osp-overlay .co-row-page svg { opacity: 0.8; }
/*
 * Which screen of an application a comment was left on.
 *
 * Set in the monospace face and boxed, because it is an address rather than
 * a name: "#/settings" read in the panel has to be recognisable as the thing
 * in the address bar when the reviewer gets there. It is the one label in a
 * row that is not prose, so it is the one that should not be set like prose.
 */
.osp-overlay .co-row-screen {
  flex: none;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 4px;
  border: 1px solid var(--co-line);
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 9px;
  line-height: 13px;
  color: var(--co-fg-2);
}

/* A row that leads to another page rather than opening a pin on this one.
   Said with the number badge, which is the part that means "there is a mark
   over there wearing this": hollow here, because the mark is not on screen
   to be pointed at. */
.osp-overlay .co-row[data-away] .co-num {
  background: transparent;
  border: 1px solid var(--co-line);
  color: var(--co-fg-2);
}
.osp-overlay a.co-row[data-away]:hover .co-num { border-color: var(--co-fg-3); color: var(--co-fg); }
/* A comment with no page recorded against it -- one written into the review
   file by hand. It is listed, but there is nowhere for it to lead. */
.osp-overlay div.co-row[data-away] { cursor: default; }

/* --- the comment popup ------------------------------------------------ */

.osp-overlay .co-pop {
  position: absolute;
  width: 360px;
  max-height: 400px;
  overflow-y: auto;
  pointer-events: auto;
  background: var(--co-bg);
  border: 1px solid var(--co-line);
  border-radius: var(--co-r-3);
  box-shadow: var(--co-shadow);
  color: var(--co-fg);
  animation: co-rise 0.15s var(--co-ease);
  z-index: 2;
}

/*
 * Stepping from one mark to the next, as a move rather than a cut.
 *
 * The arrows swapped the card's contents where it stood, which left a
 * reviewer to work out for themselves that the card was now about
 * something else -- and about words that were often not on screen at all.
 * So the card travels to the next pin while the page scrolls it into view,
 * and its new contents fade up rather than appearing mid-flight. The two
 * movements are the same length, so they read as one.
 *
 * Only while a step is in progress: the attribute is set by the script for
 * the duration and dropped afterwards, so the card still follows a reflow
 * instantly, and still rises into place rather than sliding in when it is
 * opened for the first time.
 */
.osp-overlay .co-pop[data-gliding] {
  transition: left 0.34s var(--co-ease), top 0.34s var(--co-ease);
}
.osp-overlay .co-pop[data-gliding] > * { animation: co-fade 0.3s var(--co-ease); }
@keyframes co-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

/*
 * The title bar: what this is, how much it is asking for, and what can be
 * done to it. Three things, left to right, and the actions pushed to the far
 * edge so the eye has one place to look for a button rather than a row that
 * reflows as a quotation gets longer.
 */
.osp-overlay .co-pop-head {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 40px;
  padding: 6px 8px 6px 14px;
  border-bottom: 1px solid var(--co-line);
  background: var(--co-bg-2);
}
/*
 * Which mark this is, and how many the page has.
 *
 * It said "Comment", which the thing it titles is self-evidently already.
 * The number is the pin's own -- comments are numbered by age within a page
 * and so is this -- so the head ties the card to the mark under it and says
 * how far through the page the reviewer is, which is what the arrows beside
 * it are for.
 */
.osp-overlay .co-pop-pos {
  flex: none;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.osp-overlay .co-pop-pos span { color: var(--co-fg-3); font-weight: 450; }
.osp-overlay .co-pop-acts {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
  margin-left: auto;
}

/*
 * Priority as three hues, each carrying its arrow.
 *
 * Three levels read as a scale, and a scale is read fastest by colour, so
 * each level is drawn in its own: crimson, amber, blue. None of them is the
 * pin's vermilion, which already means "open, not dealt with" -- see the
 * tokens above for why that boundary is worth keeping. The arrow stays in
 * every pill, because colour alone is not a label: a reader who cannot
 * separate crimson from amber still has to be able to tell high from medium.
 *
 * One rule set serves the pill in the popup, the three buttons in the draft,
 * the rows of the priority menu and the chip in a panel row, so a level is
 * the same colour wherever it appears.
 */
.osp-overlay .co-pri,
.osp-overlay .co-pri-opt,
.osp-overlay .co-row-pri {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  padding: 2px 9px;
  border: 1px solid var(--co-line);
  border-radius: 999px;
  background: var(--co-bg-2);
  color: var(--co-fg-2);
  font: inherit;
  font-size: 11px;
  font-weight: 550;
  line-height: 15px;
  transition: background 0.14s, color 0.14s, border-color 0.14s;
}
.osp-overlay .co-pri-mark {
  width: 8px;
  text-align: center;
  font-weight: 700;
}

/* The one place the hue is named, so every pill of a level matches. */
.osp-overlay [data-level="high"] {
  --co-pri-fg: var(--co-pri-high-fg);
  --co-pri-bg: var(--co-pri-high-bg);
  --co-pri-line: var(--co-pri-high-line);
}
.osp-overlay [data-level="medium"] {
  --co-pri-fg: var(--co-pri-medium-fg);
  --co-pri-bg: var(--co-pri-medium-bg);
  --co-pri-line: var(--co-pri-medium-line);
}
.osp-overlay [data-level="low"] {
  --co-pri-fg: var(--co-pri-low-fg);
  --co-pri-bg: var(--co-pri-low-bg);
  --co-pri-line: var(--co-pri-low-line);
}

.osp-overlay .co-pri[data-level],
.osp-overlay .co-row-pri[data-level] {
  background: var(--co-pri-bg);
  border-color: var(--co-pri-line);
  color: var(--co-pri-fg);
}
.osp-overlay .co-pri[data-level]:hover { border-color: var(--co-pri-fg); }

/* A comment on another page is read in the panel rather than against its
   pin, so the chip is the only thing saying how much it is asking for. It
   is quieter than the popup's pill -- the row already carries a number, a
   name and sometimes an issue -- and says the level with its arrow and hue
   rather than repeating the word. */
.osp-overlay .co-row-pri {
  padding: 1px 6px;
  font-size: 10px;
  line-height: 14px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.osp-overlay .co-row[data-resolved] .co-row-pri {
  background: var(--co-bg-2);
  border-color: var(--co-line);
  color: var(--co-fg-3);
}

/*
 * What the comment is attached to, quoted above it.
 *
 * A band rather than a line of text, so "this is the page talking" and "this
 * is a person talking" are told apart before either is read.
 */
.osp-overlay .co-pop-sel {
  display: flex;
  align-items: flex-start;
  margin: 12px 16px 0;
  padding: 8px 10px;
  border-left: 2px solid var(--co-pin);
  border-radius: 0 var(--co-r-1) var(--co-r-1) 0;
  background: var(--co-pin-soft);
}
/* Drained, like the pin, once there is nothing left to do about it. */
.osp-overlay .co-pop-sel[data-resolved],
.osp-overlay .co-pop-sel[data-orphan] {
  border-left-color: var(--co-done);
  background: var(--co-bg-2);
}
.osp-overlay .co-pop-quote {
  flex: 1;
  min-width: 0;
  color: var(--co-fg-2);
  font-size: 12px;
  line-height: 17px;
  font-style: italic;
  overflow-wrap: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.osp-overlay .co-pop-btn {
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: var(--co-r-1);
  background: transparent;
  color: var(--co-fg-2);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s, color 0.12s;
}
.osp-overlay .co-pop-btn:hover { background: var(--co-bg-2); color: var(--co-fg); }
.osp-overlay .co-pop-btn[data-on] { color: var(--co-pin); }

/*
 * An arrow with nowhere to go, and an arrow that leaves the page.
 *
 * The arrows walk the whole review, so the next mark is often on another
 * page -- a navigation rather than a scroll, which is a bigger thing than
 * the control looks like it does. The title says which page, but a title is
 * read only by somebody who already wondered; the dot is what makes them
 * wonder, and it costs four pixels.
 */
.osp-overlay .co-pop-btn:disabled { opacity: 0.3; }
.osp-overlay .co-pop-btn:disabled:hover { background: transparent; color: var(--co-fg-2); }
.osp-overlay .co-pop-btn[data-away] { position: relative; }
.osp-overlay .co-pop-btn[data-away]::after {
  content: "";
  position: absolute;
  top: 4px;
  right: 4px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--co-pin);
}
.osp-overlay .co-pop-btn:disabled::after { display: none; }

.osp-overlay .co-pop-threads {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 0;
}
.osp-overlay .co-pop-sel + .co-pop-threads { padding-top: 10px; }
.osp-overlay .co-pop-row {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 0 16px;
  min-width: 0;
}
.osp-overlay .co-avatar {
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: var(--co-bg-2);
  border: 1px solid var(--co-line);
  color: var(--co-fg-2);
  font-size: 11px;
  font-weight: 650;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.osp-overlay .co-pop-wrap { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.osp-overlay .co-pop-name {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.osp-overlay .co-pop-name strong {
  font-weight: 550;
  font-size: 13px;
  line-height: 24px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.osp-overlay .co-pop-body { line-height: 21px; white-space: pre-wrap; word-break: break-word; }

.osp-overlay .co-pop-note {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 0 16px 12px;
  padding: 9px 10px;
  border-radius: var(--co-r-2);
  background: var(--co-bg-2);
}

.osp-overlay .co-resolved-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 16px;
  border-top: 1px solid var(--co-line);
  color: var(--co-fg-2);
  font-size: 12px;
}
.osp-overlay .co-resolved-row > span:first-child {
  flex: none;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--co-done);
}

/*
 * Why a filing did not happen, under the comment it was attempted on.
 *
 * Built like the resolved row it sits beside, because the two say the same
 * kind of thing: not what the comment is, but what has become of it. Where
 * a comment *did* go is the foot's own button now -- see co-act[data-filed]
 * below -- so this row is only ever a refusal.
 */
.osp-overlay .co-filed {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  padding: 9px 16px;
  border-top: 1px solid var(--co-line);
  color: var(--co-fg-2);
  font-size: 12px;
}
.osp-overlay .co-filed .co-warn { flex-basis: 100%; }
/*
 * A link that leaves the page, drawn in the ink wherever it appears.
 *
 * The colour was dropped from here when the filed-issue button took it over
 * through \`co-act[data-filed]\`, which left the one other user of this class
 * -- the address an export tells a reviewer to send the file to -- wearing
 * the browser's default blue and underline inside an overlay that has
 * neither anywhere else.
 */
.osp-overlay .co-ext {
  color: var(--co-ink);
  font-weight: 550;
  text-decoration: none;
}
/* The underline is for a link sitting in a sentence. The filed-issue button
   wears this class too and has a stroke of its own on all four sides, which
   a bottom border of its own would fight. */
.osp-overlay .co-ext:not(.co-act) { border-bottom: 1px solid transparent; }
.osp-overlay .co-ext:not(.co-act):hover { border-bottom-color: currentColor; }

/*
 * The foot: what can be done about this comment, as words.
 *
 * Resolve and the overflow used to be icons in the title bar, beside the
 * close, where the one button that ends a comment's life looked exactly
 * like the one that dismisses the card. Down here they are a labelled
 * primary and a quiet overflow, which is the ordinary shape of a dialog and
 * takes no learning.
 */
.osp-overlay .co-pop-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--co-line);
}
/*
 * The overflow is pinned to the far end and never shrinks.
 *
 * It holds Edit and Delete, which are the only way to either, so it going
 * missing is worse than any label in here going short. The foot does not
 * wrap -- two rows of buttons under a card this size reads as two separate
 * questions -- so a label that cannot fit is ellipsized instead, and this
 * button keeps its 26px whatever the rest comes to.
 */
.osp-overlay .co-pop-foot .co-pop-btn { flex: none; margin-left: auto; }
.osp-overlay .co-act {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 1 auto;
  min-width: 0;
  padding: 7px 14px;
  border: 1px solid var(--co-line);
  border-radius: var(--co-r-2);
  background: var(--co-bg);
  color: var(--co-fg);
  font-size: 12px;
  font-weight: 550;
  text-decoration: none;
  transition: border-color 0.14s, background 0.14s, filter 0.14s;
}
.osp-overlay .co-act:hover { border-color: var(--co-fg-3); }
/* The icon stays; the word gives way. A button whose label is cut short
   still says which button it is, where one pushed off the card says
   nothing at all. */
.osp-overlay .co-act svg { flex: none; }
.osp-overlay .co-act span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* The primary keeps its label whole. Its three wordings are known and
   short; what has to give way is the issue key beside it, which is as long
   as somebody's repository happens to be. */
.osp-overlay .co-act[data-primary] {
  flex: none;
  background: var(--co-pin);
  border-color: var(--co-pin);
  color: #fff;
}
.osp-overlay .co-act[data-primary]:hover { filter: brightness(1.06); }
/*
 * Filed, and saying so in the ink.
 *
 * The action and its result were the same button in two states that looked
 * alike, so whether an issue already existed had to be read off the label.
 * The stroke answers it first, and the ink is the same one the issue key
 * wears everywhere else: this is the one control in the overlay that leaves
 * the page.
 */
.osp-overlay .co-act[data-filed] {
  border-color: var(--co-ink);
  color: var(--co-ink);
}
.osp-overlay .co-act[data-filed]:hover {
  background: var(--co-pin-soft);
  border-color: var(--co-ink);
}
.osp-overlay .co-act[disabled] { opacity: 0.5; cursor: default; }
.osp-overlay .co-act[disabled]:hover { border-color: var(--co-line); }

.osp-overlay .co-pop-reply {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 16px;
  border-top: 1px solid var(--co-line);
}
.osp-overlay .co-pop-reply .co-avatar { margin-top: 2px; }
.osp-overlay .co-pop-reply .co-input { flex: 1; }
.osp-overlay .co-pop-reply .co-input textarea { max-height: 120px; }

.osp-overlay .co-pop-menu {
  position: absolute;
  padding: 4px;
  background: var(--co-bg);
  border: 1px solid var(--co-line);
  border-radius: var(--co-r-2);
  box-shadow: var(--co-shadow);
  white-space: nowrap;
  animation: co-rise 0.14s var(--co-ease);
  z-index: 10;
}
.osp-overlay .co-pop-menu-item {
  display: block;
  width: 100%;
  padding: 6px 12px;
  border: 0;
  border-radius: var(--co-r-1);
  background: transparent;
  color: var(--co-fg);
  font-size: 12px;
  text-align: left;
  transition: background 0.12s;
}
.osp-overlay .co-pop-menu[data-pri] .co-pop-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px 6px 10px;
}
.osp-overlay .co-pop-menu[data-pri] .co-pop-menu-item .co-pri-mark {
  color: var(--co-pri-fg);
}
.osp-overlay .co-pop-menu[data-pri] .co-pop-menu-item[data-on] {
  background: var(--co-pri-bg);
  color: var(--co-pri-fg);
  font-weight: 550;
}
.osp-overlay .co-pop-menu-item:hover { background: var(--co-bg-2); }
.osp-overlay .co-pop-menu-item[data-danger]:hover { background: var(--co-danger); color: #fff; }

/* --- the draft, and the field it shares with replies ------------------ */

.osp-overlay .co-draft {
  position: absolute;
  width: 288px;
  max-width: calc(100vw - 16px);
  padding: 10px;
  pointer-events: auto;
  background: var(--co-bg);
  border: 1px solid var(--co-line);
  border-radius: var(--co-r-3);
  box-shadow: var(--co-shadow);
  animation: co-rise 0.16s var(--co-ease);
  z-index: 2;
}

/* The words the pin is about, so the comment is written with them in view
   rather than behind the box being typed into. */
.osp-overlay .co-draft-quote {
  margin-bottom: 8px;
  padding-left: 8px;
  border-left: 2px solid var(--co-aim-line);
  color: var(--co-fg-2);
  font-size: 11px;
  line-height: 16px;
  overflow-wrap: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.osp-overlay .co-draft-foot { display: flex; gap: 4px; margin-top: 8px; }
/* Three buttons, one of them chosen. Only the chosen one wears its hue: all
   three coloured at once would be a row of swatches to decode rather than a
   question with an answer already in it. */
.osp-overlay .co-pri-opt {
  padding: 2px 8px;
  background: transparent;
  border-color: transparent;
  color: var(--co-fg-3);
  cursor: pointer;
}
.osp-overlay .co-pri-opt:hover { color: var(--co-pri-fg); border-color: var(--co-pri-line); }
.osp-overlay .co-pri-opt[data-on] {
  background: var(--co-pri-bg);
  border-color: var(--co-pri-line);
  color: var(--co-pri-fg);
}

.osp-overlay .co-input {
  position: relative;
  min-height: 30px;
  border-radius: var(--co-r-2);
  background: var(--co-bg-2);
  border: 1px solid transparent;
  transition: border-color 0.14s, background 0.14s;
}
.osp-overlay .co-input:focus-within { border-color: var(--co-pin); background: var(--co-bg); }
.osp-overlay .co-input textarea {
  display: block;
  width: 100%;
  min-height: 28px;
  max-height: 200px;
  padding: 4px 34px 4px 9px;
  border: 0;
  border-radius: var(--co-r-2);
  background: transparent;
  color: var(--co-fg);
  font: inherit;
  line-height: 20px;
  resize: none;
  outline: none;
  overflow: hidden;
}
.osp-overlay .co-input textarea::placeholder { color: var(--co-fg-3); }
.osp-overlay .co-input[data-filled] { min-height: 58px; }
.osp-overlay .co-input[data-filled] textarea { padding-right: 9px; padding-bottom: 30px; }

.osp-overlay .co-send {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 23px;
  height: 23px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--co-pin);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.14s, transform 0.14s var(--co-ease);
}
.osp-overlay .co-input[data-filled] .co-send { top: auto; bottom: 5px; transform: none; }
.osp-overlay .co-send:hover:not(:disabled) { background: var(--co-ink); }
.osp-overlay .co-send:disabled { background: var(--co-line); color: var(--co-fg-3); cursor: default; }

/* --- the modal, for a name and for a confirmation --------------------- */

.osp-overlay .co-scrim {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  background: rgba(10, 12, 15, 0.45);
  z-index: 3;
}
.osp-overlay .co-modal {
  width: 380px;
  max-width: calc(100vw - 32px);
  background: var(--co-bg);
  border: 1px solid var(--co-line);
  border-radius: var(--co-r-3);
  box-shadow: var(--co-shadow);
  animation: co-rise 0.18s var(--co-ease);
}
.osp-overlay .co-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 42px;
  padding: 0 8px 0 16px;
  border-bottom: 1px solid var(--co-line);
}
.osp-overlay .co-modal-head h3 { font-size: 13px; font-weight: 550; }
.osp-overlay .co-modal-body { padding: 14px 16px 16px; }
.osp-overlay .co-modal-body p {
  margin-bottom: 14px;
  color: var(--co-fg-2);
  line-height: 19px;
}
/* The part of an answer nobody asked for but is owed anyway: what the
   import left out, and why the number is smaller than expected. */
.osp-overlay .co-modal-body .co-modal-note {
  margin-top: -6px;
  color: var(--co-fg-3);
  font-size: 11px;
  line-height: 17px;
}

.osp-overlay .co-field {
  width: 100%;
  height: 34px;
  margin-bottom: 12px;
  padding: 0 10px;
  border: 1px solid var(--co-line);
  border-radius: var(--co-r-2);
  background: var(--co-bg-2);
  color: var(--co-fg);
  font: inherit;
  outline: none;
  transition: border-color 0.14s, background 0.14s;
}
.osp-overlay .co-field::placeholder { color: var(--co-fg-3); }
.osp-overlay .co-field:focus { border-color: var(--co-pin); background: var(--co-bg); }

.osp-overlay .co-submit {
  width: 100%;
  height: 34px;
  border: 0;
  border-radius: var(--co-r-2);
  background: var(--co-pin);
  color: #fff;
  font: inherit;
  font-weight: 550;
  transition: background 0.14s, opacity 0.14s;
}
.osp-overlay .co-submit:hover:not(:disabled) { background: var(--co-ink); }
.osp-overlay .co-submit:disabled { opacity: 0.45; cursor: not-allowed; }
/* Deeper and duller than the mark ink, so the one irreversible button in
   here is never mistaken for the colour that merely means "open". */
.osp-overlay .co-submit[data-danger] { background: var(--co-danger); }
.osp-overlay .co-submit[data-danger]:hover:not(:disabled) { background: #751509; }

/* --- motion, for people who have asked for less of it ------------------ */

@media (prefers-reduced-motion: reduce) {
  .osp-overlay *,
  .osp-overlay *::before,
  .osp-overlay *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;
