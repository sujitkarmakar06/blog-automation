# Blog Automation Platform

A multi-tenant platform that automates blog publishing across projects. Users
sign in, manage separate projects (clients) — each with its own brand voice,
keywords, and **encrypted** CMS credentials — generate SEO-optimized drafts with
**Claude**, then **schedule** them to **auto-publish** to WordPress (categories,
tags, featured image, publish-or-draft) or any CMS you add via the adapter layer.

Runs out of the box with **zero external services**: Node + Express + SQLite,
a zero-build vanilla-JS dashboard, and a `mock` publishing adapter so the whole
flow works offline. Add an Anthropic key for real generation; point a project at
a real WordPress site to publish for real.

---

## What's included

**Accounts & multi-tenancy** — email/password signup & login, JWT httpOnly-cookie
sessions (bcrypt-hashed passwords). Every project and post is scoped to its owner;
one account can never read or touch another's data.

**Encrypted CMS credentials** — WordPress/CMS secrets are encrypted at rest with
AES-256-GCM (key derived from `APP_ENCRYPTION_KEY`). They're never returned to the
browser in the clear — secret fields come back masked (`••••••••`).

**Claude-powered drafting** — set `ANTHROPIC_API_KEY` and drafts are written by
Claude (structured JSON: title, meta, slug, full Markdown body), tuned by the
project's brand voice and target keywords. No key → automatic offline template
fallback, so the app always works.

**SEO optimization engine** — every post gets a live 0–100 score against an
11-point checklist (title/meta length, keyword in title & meta, keyword density,
word count, headings, links, image incl. featured image, slug) with a fix hint on
each miss, plus one-click auto-fill for slug + meta.

**Scheduling & auto-publish** — queue a post for a future time; a background
scheduler polls every 15s and publishes due posts automatically. Also Publish now.
A cross-project queue shows everything upcoming and recently published/failed.

**Richer WordPress publishing** — resolves categories & tags by name (creating any
that don't exist), uploads a featured image from a URL, and publishes live or as a
draft — all via the WordPress REST API + Application Password.

**Pluggable CMS adapters** — WordPress (live), `mock` (default, offline), plus
Ghost/Webflow stubs showing the contract. Add a CMS = one file.

**Postgres-ready data layer** — all data access goes through an async store
interface (`src/store/`). SQLite ships today; Postgres is a drop-in sibling driver
selected by `DB_DRIVER`, with no changes above the store layer.

---

## Quick start

```bash
npm install
cp .env.example .env      # optional; edit secrets & add ANTHROPIC_API_KEY
npm run seed              # optional demo account + projects
npm start                 # http://localhost:3000
```

Open http://localhost:3000 and log in with the seeded account:

- **email:** `demo@local`
- **password:** `demo1234`

Or click **Sign up** to make your own.

### Try the full loop
1. Pick a project (or **+ New** — choose WordPress and enter credentials, or keep `mock`).
2. **✦ Generate draft** (Claude if a key is set, otherwise template) or **+ New post**.
3. Edit content; watch the **SEO score**; set categories/tags/featured image; **Auto-fill meta**.
4. Choose **Publish live** or **Save as draft**, then **Schedule** (~1–2 min out) or **Publish now**.
5. Watch the **Publish Queue** tab — the scheduler fires scheduled posts automatically.

---

## Configuration (.env)

| Var | Purpose | Default |
|-----|---------|---------|
| `PORT` | HTTP port | `3000` |
| `JWT_SECRET` | Signs session tokens — **set in prod** | dev default (warns) |
| `SESSION_DAYS` | Session lifetime | `7` |
| `APP_ENCRYPTION_KEY` | Derives the AES key for CMS secrets — **set in prod** | dev default (warns) |
| `DB_DRIVER` | `sqlite` (Postgres is a future swap) | `sqlite` |
| `ANTHROPIC_API_KEY` | Enables Claude generation | empty → template |
| `ANTHROPIC_MODEL` | Claude model id | `claude-3-5-sonnet-latest` |

The server prints a warning at boot for any insecure dev default still in use.

---

## Connecting a real WordPress site

Project **Settings** → CMS = **WordPress**, then:

- **Site URL** — `https://blog.example.com`
- **Username**
- **Application Password** — WP Admin → Users → Profile → *Application Passwords*

**Test connection** verifies the credentials. On publish, the adapter maps your
comma-separated categories/tags to WP term IDs (creating missing ones), uploads the
featured image URL to the media library, and creates the post as `publish` or
`draft` per the editor toggle.

---

## Architecture

```
src/
  config.js        Env config + insecure-default warnings
  crypto.js        AES-256-GCM encrypt/decrypt for secrets at rest
  auth.js          bcrypt, JWT cookie sessions, requireAuth middleware
  store/
    index.js       Driver selector (sqlite now; postgres = future sibling)
    sqlite.js      Async repositories: users, projects, posts (+ schema)
  seo.js           SEO analysis, scoring, autofill, JSON-LD
  ai.js            Claude Messages API + offline template fallback
  adapters/
    index.js       Registry
    mock.js        Default, offline
    wordpress.js   Live: categories, tags, featured image, publish/draft
    ghost.js       Stub (contract example)
    webflow.js     Stub (contract example)
  publisher.js     Publish one post via its project's adapter
  scheduler.js     Polling loop that auto-publishes due posts
  server.js        Express API (auth-gated)
  seed.js          Demo account + data
public/            Vanilla-JS SPA: auth screen, dashboard, editor, queue
data/app.db        SQLite DB (created on first run)
```

### Adding a CMS adapter
Create `src/adapters/yourcms.js` exporting `{ id, label, configFields, validate(config), publish(post, config) }`,
register it in `src/adapters/index.js`, and it appears in project settings and works
with scheduling + publish-now automatically. `publish` receives the post (with
`categories`, `tags`, `featured_image_url`, `publish_mode`) and the project's
**decrypted** `config`.

### Adding the Postgres driver
Create `src/store/postgres.js` exposing the exact same async surface as
`sqlite.js` (`users`, `projects`, `posts` with identical method signatures),
backed by `pg`, then run with `DB_DRIVER=postgres` and `DATABASE_URL=...`.
Nothing above the store layer changes.

---

## Security notes

- Passwords are bcrypt-hashed; sessions are httpOnly-cookie JWTs (`Secure` when
  `NODE_ENV=production`).
- CMS credentials are AES-256-GCM encrypted at rest and masked in all API
  responses.
- **Before production:** set strong `JWT_SECRET` and `APP_ENCRYPTION_KEY`, serve
  over HTTPS, and consider rate-limiting the auth endpoints.

## Next steps to scale
- Swap the polling scheduler for a real job queue (BullMQ / cloud cron) with
  retries and dead-lettering for failed publishes.
- Implement the Postgres driver for concurrency.
- Add roles/teams, per-project scheduling rules, and an editorial calendar view.
- Extend generation: internal-link suggestions, image generation + alt text.
```
