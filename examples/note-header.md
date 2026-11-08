---
updated: 2026-10-24
pinned: true
tags:
  - method
  - note-taking
  - evergreen
---

# Note header, demonstrated

Copy this file into the folder you publish, build the site, and the top of the
published page will carry a header built from the three keys above.

## What each key does

`updated` dates the note. It is read by whatever key the **Date property**
setting names (`updated` by default), accepts `2026-10-24` or
`2026-10-24T18:40`, and a note without it falls back to the file's own
modified time, which is why a synced or bulk-edited vault is better off
setting it by hand. The same date orders **Recently updated** in the jump-to
panel.

`tags` becomes the row of chips. Inline `#tags` in the body count too, so this
note would show `#one-more` as well if the body used it. Each chip links to
that tag's section on the site's front page, which lists every note carrying
it.

`pinned` does not appear in the header at all. It puts the note under **Start
here**: a short list above the file tree in the left panel, and a section on
the generated front page. It is read by whatever key the **Start here
property** setting names.

Set it to a number rather than `true` to say where the note goes. `pinned: 1`
leads, then `pinned: 2`, and anything left on `true` follows in title order.

## What else the header shows

A **Links** figure (how many published notes link here, and how many this
note links out to) appears whenever either is more than zero. It is counted
from the links the build actually resolved, so a link to an unpublished note
is not in it.

## What it does not show

Everything else in the frontmatter is removed before the page is written, and
removed rather than hidden: a published page carries no trace of the keys it
was not asked for. Add `status: draft` above and nothing appears, by design:
a vault that decides what is public in its frontmatter would otherwise publish
that decision.

## Headings, so there is an outline

The note needs a few sections for the right-hand **On this page** list to have
anything to follow. This is the last of them.
