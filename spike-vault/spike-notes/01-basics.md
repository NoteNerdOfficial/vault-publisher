---
title: Basics
publish: true
---

# Basics

Plain paragraph with **bold**, *italic*, `inline code`, a [[the-glass-bead-game|wikilink]] and an [external link](https://obsidian.md).

> [!note] A callout
> Callouts are Obsidian-specific markup. They must survive serialization.

> [!warning]- A collapsed callout
> This one starts folded, which is interactive state in a static page.

## A table

| Feature | Status |
|---|---|
| Dataview | testing |
| Mermaid | testing |
| Bases | testing |

## Tasks

- [ ] An open task
- [x] A done task
- [/] A custom status character

## Math

Inline $e^{i\pi} = -1$ and a block:

$$\int_0^1 x^2 \, dx = \frac{1}{3}$$

## Code

```python
def publish(vault):
    return [render(note) for note in vault]
```

## Footnote

A claim needing a source.[^1]

[^1]: The footnote text.
