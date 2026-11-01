# HTML files published as-is, demonstrated

Copy this whole folder into the folder you publish, turn on **Publish HTML
files as-is** in settings, and build. The pages here go out byte for byte,
with the files they reference carried beside them.

Keep the folder together. The point of the feature is that a page and the
files beside it stay beside each other, so moving one file out of here
demonstrates the broken half rather than the working one.

**Why this file is not called `README.md`.** Once the folder is in your vault
this file is an ordinary note, and a note called `README.md` at the top of the
published folder is the site's front page by convention — ahead of `index.md`
and `Home.md`, and ahead of any hand-written `index.html`. The first version
of this demo was called `README.md`, which quietly took the front page, pushed
`index.html` out of it, and so left `app.js` and the four SVGs uncollected:
files are only carried for a page that is actually published. The feature
worked; the demo was shaped wrong.

## Turning it on

1. **Settings → what to publish → Publish HTML files as-is.** Off by default,
   because a vault scoped to the whole vault usually holds HTML nobody wrote
   as a web page: saved articles, plugin help, old exports.
2. The setting does nothing while **Require a frontmatter flag** is set. An
   HTML file has no frontmatter to put the flag in, so it cannot opt in, and
   publishing it anyway would apply your gate to notes and not to pages. The
   setting's own description says so when that is the case, and the build
   report counts what the flag held back.

## What is in here

| File | What it is for |
|---|---|
| `about-this-demo.md` | This file, published as an ordinary note |
| `index.html` | The page that styles itself, four different ways |
| `styles.css` | Its stylesheet, referenced by a relative path |
| `app.js` | A script, to show a published page still works |
| `art/panel.svg` | An image, referenced by `src` |
| `art/panel-wide.svg` | Named only by a `srcset` candidate |
| `art/texture.svg` | Named only by a `url()` in a `<style>` block |
| `art/badge.svg` | Named only by a `url()` in a `style` attribute |
| `charts/trend.html` | A second page, one folder down |
| `charts/trend.css` | Its own stylesheet, beside it |
| `page-linked-from-a-note.md` | An ordinary note, linking to both pages |

## What to look for

**The pages kept their own look.** `styles.css` is deliberately unlike the
site: a serif face, warm paper, a narrow measure. If the published page looks
like that, it kept its styling. If it looks like the rest of the site,
something rewrote it.

**All four styling routes survived.** The stylesheet sets the type, the
`<style>` block draws the panel's border, a `url()` inside that block fills
it with a texture, and `style` attributes set the heading's letter-spacing and
the circle in the list. A page whose texture or circle is missing is a page
whose `url()` references were not followed.

**The files travelled.** In the built site, next to the pages, you should find
`styles.css`, `app.js`, `art/` with all four SVGs, and `charts/trend.css`. The
folder structure is mirrored, which is what makes `href="styles.css"` and
`href="../styles.css"` both still true without being rewritten.

**The second page reaches out of its folder.** `charts/trend.html` loads
`../styles.css`, so matching type on both pages means `..` survived.

**The note's wikilinks are live.** `page-linked-from-a-note.md` links to both
pages, with `[[index.html]]` and `[[trend.html]]`. Before this feature those
were dead text. Note the second form: a wikilink is matched by the shortest
unique name or by the full path from the vault root, so `[[trend.html]]`
resolves and `[[charts/trend.html]]` does not — the same rule notes follow,
and worth knowing before you conclude the link is broken.

**One link is deliberately wrong.** `index.html` links to
`page-linked-from-a-note.md`, and a note is published as its `.html` page,
never as Markdown. The build report names it and says where to point it
instead. It is in the report rather than fixed in place because the file is
published as written — that is the whole contract.

**The pages are not in the navigation.** No vault panel row, no browse entry,
no tag page, no graph node, no backlinks. They have no frontmatter, no tags
and no outline, so there is nothing to put in those places. The note is how a
reader gets to them.

**Which page is the front page depends on how you scoped the publish.** Both
answers are correct and the page itself is identical either way:

- **Scope is this folder.** `index.html` sits at the top of it, so it takes the
  front page, and the generated overview steps aside rather than being written
  over the top of it. The site's browse and tag pages are still there.
- **Scope is the whole vault.** This page is one folder down, at
  `html-as-is/index.html`, and the site keeps its generated front page.

## Reviewing one of these pages

The comment overlay works on them, which it did not at first. A page
published as-is has none of our markup in it, so there was nothing for the
overlay to be injected into and no `data-osp-block` for a pin to hold on to.
Both are now handled: a preview build appends the overlay at the end of the
file, between a pair of `osp-review` comments, and the overlay hashes the
page's own blocks in the browser to produce the same anchors the build would
have written. Drop a pin on a paragraph here and it survives a rebuild.

If the page renders itself — a React or Angular prototype, say — two more
things apply. The overlay marks the page again whenever the document changes,
so a pin dropped after the app has rendered holds onto the text it was about
rather than a spot on the screen. And a pin records the browser's own URL, so
a comment left on one screen of the app shows on that screen and not on the
others.

The rule to tell a reviewer is short: **a pin holds onto text that does not
change.** Labels, headings and copy are stable, which is what design feedback
is mostly about. A counter or a live list is not, and a pin on one of those
falls back to the point it was dropped on, with the panel saying the text has
changed.

Two consequences worth knowing:

- **Only a preview gets it.** A publish never does, so the file on the site is
  the author's file and nothing else.
- **A byte-for-byte check needs the overlay off.** While it is on, the preview
  copy of one of these pages is the vault's file plus that appended block, so
  `diff` will show it. Turn **Include a review overlay** off for that check,
  or ignore what sits between the two comments.

The site's own generated pages — the browse listing and the tag pages — still
have no overlay, and that one is not an oversight. A comment is filed against
a path in the vault, and those pages were not built from a file: there is
nothing for a comment to be about.

## Three more things to try

**Lose a collision, on purpose.** Add a note called `index.md` or `README.md`
beside this folder's `index.html` and build again. A note's page always wins,
so the report's **Skipped** section names the HTML file:

```
- html-as-is/index.html: would publish to index.html, which index.html
  already occupies -- a note's page wins, so the HTML file is not published
```

Two knock-on effects are worth seeing, because neither is obvious. The other
page's link to `../index.html` is reported as pointing at the page that took
the path, rather than as a plain 404. And `app.js` and the four SVGs vanish
from the site, because the only page that referenced them is no longer being
published — files are carried for a page, not for a folder. Take the note out
again and they come back.

**See the `app://` warning.** Paste this into `index.html` and build:

```html
<img src="app://local/example-vault/art/panel.svg" alt="">
```

That is Obsidian's own resource scheme. In a rendered note the publisher
strips it, because the URL contains the absolute path of the vault — your home
directory, so your account name — and resolves for nobody but you. An as-is
page cannot be touched, so the build report warns about it instead and leaves
it to you. Take the line out again afterwards.
