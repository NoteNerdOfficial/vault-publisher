# Sign-in for shared comments

An optional add-on for sharing comments through GitHub issues. With it, a
reviewer signs in with GitHub once and posts comments straight from your
published site. Without it, each comment opens GitHub's own prefilled "New
issue" form instead, which needs no setup at all.

It also lets shared comments use a **private** repository: reviewers then
sign in to read the comments as well as to post them.

You run it yourself, under your own accounts. It is one file, `worker.js`,
and it does one thing: it swaps GitHub's sign-in code for a token, which
needs your app's secret, and a published page cannot keep a secret. Posting
and reading go from each reviewer's browser to GitHub directly and never pass
through it.

## What it costs

On Cloudflare's free plan, nothing: the Worker is called when a reviewer
signs in, and again every eight hours or so while they keep working, which is
far below the free plan's 100,000 requests a day. The free plan never charges.
Past the limit, sign-in stops working until midnight UTC. Check Cloudflare's
current terms before relying on this.

## Setting it up

You need the site's GitHub repository and a Cloudflare account. It takes
about ten minutes.

### 1. Create a GitHub App

On GitHub, go to **Settings → Developer settings → GitHub Apps → New GitHub
App**. For a repository owned by an organisation, create it under the
organisation instead.

- **GitHub App name:** anything reviewers will recognise, such as "Acme
  site comments". They see it when they sign in.
- **Homepage URL:** your published site.
- **Callback URL:** leave it for now; you fill it in at step 3.
- **Expire user authorization tokens:** leave this on.
- **Webhook:** turn **Active** off. The Worker does not use webhooks.
- **Repository permissions → Issues:** Read and write. Leave every other
  permission at **No access**.
- **Where can this GitHub App be installed?** Only on this account.

Create the app. On its page, note the **Client ID**, then **Generate a new
client secret** and copy it somewhere safe for a moment.

Then **Install App** and choose **Only select repositories**, picking the
site's repository. A sign-in can only post on repositories the app is
installed on, which is what keeps a reviewer's token limited to your site's
comments.

### 2. Deploy the Worker

In the Cloudflare dashboard, go to **Workers & Pages → Create → Create
Worker**, give it a name such as `review-signin`, and deploy the starter.
Then **Edit code**, replace everything with the contents of `worker.js`, and
deploy again.

In the Worker's **Settings → Variables and Secrets**, add:

| Name | Type | Value |
| --- | --- | --- |
| `GITHUB_CLIENT_ID` | Text | the app's Client ID |
| `GITHUB_CLIENT_SECRET` | Secret | the client secret |
| `ALLOWED_ORIGINS` | Text | your site's origin, e.g. `https://you.github.io` |
| `GITHUB_URL` | Text | only for GitHub Enterprise Server, e.g. `https://github.example.com` |

`ALLOWED_ORIGINS` is the important one. The Worker only ever sends a reviewer
back, with their token, to an origin listed here. Give the origin only: no
path and no trailing slash. Several sites can share one Worker, separated by
commas.

Note the Worker's address, such as `https://review-signin.you.workers.dev`.

### 3. Point the app at the Worker

Back in the GitHub App's settings, set the **Callback URL** to the Worker's
address followed by `/callback`, such as
`https://review-signin.you.workers.dev/callback`, and save.

### 4. Tell the plugin

In Obsidian, under **Vault Publisher → Leave a review**, set **How readers'
comments reach you** to **GitHub issues**, paste the Worker's address into
**Sign-in service**, and publish again.

## How a reviewer uses it

The first time they post, they are offered **Sign in with GitHub** or **Use
GitHub's form**. Signing in takes them to GitHub to approve your app, then back
to the same page. The comment they wrote is posted, and so are the ones after
it, without leaving the page. **Sign out of GitHub** is in the overlay's menu.

## Running it somewhere other than Cloudflare

`worker.js` uses only standard web APIs (`fetch`, `Request`, `Response`,
`URL`), so it runs with little or no change on other hosts that speak them:
Deno Deploy, Vercel or Netlify edge functions, or an internal server behind
an adapter. Whatever runs it needs the same four settings, must be reachable
over HTTPS by reviewers, and must be able to reach GitHub.

That makes it workable in a company where Cloudflare is not allowed: host
it internally, set `GITHUB_URL` to the company's Enterprise Server, and
create the GitHub App on that server rather than on github.com. If nothing
can be hosted at all, the plugin's README covers the options that need no
sign-in service, under "In a company setting".

## What it keeps

Nothing. It stores no tokens and no logs of its own. Each reviewer's tokens
are kept in their browser, for your site only, and **Sign out of GitHub**
removes them.
