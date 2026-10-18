# vault-publisher

Publishes an Obsidian vault as a static website, rendered by Obsidian itself.

Status: **spike complete**, product work beginning. The render, build and GitHub publish path all work and have been verified end to end against a real repository. The theme and the setup UI are not built yet.

The working plan lives in `docs/PLAN.md` (local only, not tracked).

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
  bases.ts        re-emits Bases views as semantic tables and cards
  buildSite.ts    selection, render, assemble
src/github/
  client.ts       Git Data API: blobs, tree, commit, ref, Pages
research/       findings, including the competitive scan and spike results
docs/           the working plan
```

## Development

```sh
npm install
npm run build
node scripts/deploy.mjs            # deploys to the test vault
node scripts/deploy.mjs /path/to/vault
```

The test vault lives outside this repo, at `~/Documents/Obsidian/spike-vault`, so plugin source is never mixed up with the notes used to exercise it. Override with `VAULT_PUBLISHER_VAULT` or a path argument.

The plugin's `data.json` has an `autoRun` key (`spike`, `build`, `publish`, `diagnose`) so a run can be triggered by deploying rather than by clicking, which is what makes iteration measurable. Install [hot-reload](https://github.com/pjeby/hot-reload) in the test vault and bump the manifest version to trigger a reload.

## Known issues

- **Bases interactivity.** Views are re-emitted as our own tables and cards, which fixed the layout and recovered numeric values that were publishing blank. Sorting and view switching are gone, as with all interactivity.
- **Bases virtualization.** The grid renders only visible rows, so a long base could publish truncated. A guard compares emitted rows against the count Bases reports and aborts the publish; it is written but not yet exercised against a large base.
- **Mermaid is light-themed.** Diagrams serialize with resolved colours from Mermaid's default light theme, so a dark site needs a re-render or a colour rewrite.
- **Mermaid needs vault consent.** Obsidian 1.14 gates diagrams per vault; the plugin detects this rather than bypassing it.
- **dataviewjs is off by default** in Dataview's settings, and its errors would publish verbatim.
- **Interactivity is lost.** Bases sorting, dataviewjs buttons and collapsed callouts are static once published.
- **Scale is unproven.** A clean vault builds 7 notes in 1,690ms, but 7 notes is not 500, and a long publish session may degrade its own environment. This is the next thing to test.
