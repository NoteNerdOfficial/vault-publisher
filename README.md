# vault-publisher

Publishes an Obsidian vault as a static website, rendered by Obsidian itself.

Status: **spike**. The render and build pipeline works; the GitHub publish path is written but not yet exercised against a real repository.

## Why it renders in Obsidian

Dataview, Datacore, Bases and Mermaid output exists only inside a running Obsidian. Any publisher that converts Markdown outside the app has to reimplement them, which is why most alternatives either skip those features or hand you a static-site generator and leave it to you.

So the plugin renders each note through Obsidian's own renderer, waits for the asynchronous parts to finish, and serializes the result. The cost of that choice: publishing only happens from a running desktop Obsidian, and nothing can rebuild the site on a server.

## Why there is no GitHub Actions workflow

Two reasons. A CI build cannot render Dataview, so it would have nothing to do. And Actions is frequently blocked on corporate networks, which is one of the places this is meant to be useful.

The plugin commits the *built* site through the Git Data API and points GitHub Pages at the branch. No git binary, no workflow file, no `workflow` token scope.

## Layout

```
src/render/     rendering a note through Obsidian and knowing when it is done
  settle.ts       waiting for async plugin output; content-aware, not just a timer
  renderNote.ts   the offscreen host and the render/serialize cycle
  probe.ts        what came out, per block: ok, empty, error or blocked
  cssProbe.ts     which stylesheets are readable, and whose they are
  diagnose.ts     samples a render over time when something renders incomplete
src/publish/    turning rendered HTML into a site
  normalize.ts    repairs markup that a browser would rearrange on reparse
  links.ts        wikilinks to relative URLs; unpublished targets degrade safely
  page.ts         document shell, heading ids, table of contents
  theme.ts        the site's own stylesheet (placeholder; design work pending)
  harvestCss.ts   lifts layout-critical rules from the running app
  buildSite.ts    selection, render, assemble
src/github/
  client.ts       Git Data API: blobs, tree, commit, ref, Pages
research/       findings, including the competitive scan and spike results
spike-vault/    test notes chosen to break things
```

## Development

```sh
npm install
npm run build
node scripts/deploy.mjs /path/to/vault
```

The plugin's `data.json` has an `autoRun` key (`spike`, `build`, `publish`, `diagnose`) so a run can be triggered by deploying rather than by clicking, which is what makes iteration measurable. Install [hot-reload](https://github.com/pjeby/hot-reload) in the test vault and bump the manifest version to trigger a reload.

## Known issues

- **Bases layout.** Data renders correctly, but Bases builds its view with absolute positioning and CSS variables meant for an app pane. Harvesting its rules gets close; re-emitting the data as a semantic table is probably the better answer.
- **Mermaid is light-themed.** Diagrams serialize with resolved colours from Mermaid's default light theme, so a dark site needs a re-render or a colour rewrite.
- **Mermaid needs vault consent.** Obsidian 1.14 gates diagrams per vault; the plugin detects this rather than bypassing it.
- **dataviewjs is off by default** in Dataview's settings, and its errors would publish verbatim.
- **Interactivity is lost.** Bases sorting, dataviewjs buttons and collapsed callouts are static once published.
- **Scale is unmeasured.** Timings so far come from a vault with other plugins competing for the event loop.
