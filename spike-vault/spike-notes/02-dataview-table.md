---
title: Dataview table
publish: true
---

# Dataview table

A table query over the library folder:

```dataview
TABLE author AS "Author", status AS "Status", rating AS "Rating", pages AS "Pages"
FROM "library"
SORT rating DESC
```

A table with a computed column:

```dataview
TABLE author, round(pages / 100, 1) AS "Hundreds of pages"
FROM "library"
WHERE status = "done"
SORT pages DESC
```

A query that returns nothing, to see what empty output looks like:

```dataview
TABLE author
FROM "library"
WHERE status = "abandoned"
```

A deliberately broken query, to see how errors serialize:

```dataview
TABLE FROM WHERE SORT nonsense((
```
