---
title: Dataviewjs
publish: true
---

# Dataviewjs

A rendered table built in JavaScript:

```dataviewjs
const pages = dv.pages('"library"').sort(p => p.rating, 'desc');
dv.table(
  ["Book", "Author", "Rating"],
  pages.map(p => [p.file.link, p.author, p.rating])
);
```

A header and a paragraph written from script:

```dataviewjs
dv.header(3, "Written by script");
dv.paragraph(`Counted ${dv.pages('"library"').length} books at ${new Date().toISOString()}.`);
```

An interactive control, which cannot survive a static snapshot:

```dataviewjs
const btn = dv.container.createEl("button", { text: "Click me" });
btn.onclick = () => btn.setText("Clicked");
```

A script that throws, to see error output:

```dataviewjs
throw new Error("deliberate failure");
```
