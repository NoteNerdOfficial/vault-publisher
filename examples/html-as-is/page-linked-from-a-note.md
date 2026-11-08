---
updated: 2026-10-31
tags:
  - example
---

# Linking to a hand-written page

This is an ordinary note, rendered and wrapped in the site's shell like every
other note. It is here to show the one thing that changed on the Markdown side
of the feature: **a wikilink to an HTML file now resolves.**

## The links

Both of these point at files published as-is, and both should be live links on
the published page:

- [[index.html]]: the page that styles itself
- [[trend.html]]: the second page, one folder down

Two things about how those are written, both of them the ordinary wikilink
rules rather than anything new.

**The extension is required.** That is how Obsidian itself writes a link to a
file that is not a note, so `[[index]]` finds nothing at all.

**The name is the shortest unique one, or the full path from the vault root.**
`[[trend.html]]` resolves; `[[charts/trend.html]]` does not, even though the
file really is in a `charts` folder. A partial path has never been one of the
two forms a wikilink is matched by, for notes any more than for pages, so a
link written that way degrades to plain text, which is what the next section
describes.

## What it looked like before

A link like the two above resolved to nothing, so the build downgraded it to
plain text with a `osp-unresolved-link` class, the same treatment a link to an
unpublished note gets. That was correct at the time: the file really was not
being published. Now that it is, the link is a link.

## What is still not linked

Nothing in the site's own navigation points at these pages. They are not notes:
they have no frontmatter, no tags, no outline to list and no backlinks to show,
so they stay out of the vault panel, the browse page, the tag pages and the
graph. A note is how a reader reaches them, which is what this note is for.
