---
title: Bases
publish: true
---

# Bases

An embedded base file:

![[Reading.base]]

A specific view of the same base:

![[Reading.base#Shelf]]

An inline base code block:

```base
filters:
  and:
    - file.hasTag("book")
views:
  - type: table
    name: "Inline"
    order:
      - file.name
      - author
      - rating
```
