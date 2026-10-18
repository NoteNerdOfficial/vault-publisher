---
title: Dataview list and inline
publish: true
total: 42
---

# Dataview list and inline

A list query:

```dataview
LIST
FROM "library"
WHERE rating >= 4
SORT file.name ASC
```

A task query:

```dataview
TASK
FROM "spike-notes"
WHERE !completed
```

Inline queries in a sentence: this vault holds `= length(this.file.outlinks)` outgoing links, and the frontmatter total is `= this.total`.

An inline JS query: `$= dv.pages('"library"').length` books.
