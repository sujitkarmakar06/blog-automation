'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { encryptJson, decryptJson } = require('../crypto');

/**
 * SQLite implementation of the data store. Every method is async so the
 * public repository API is identical to a future Postgres driver — swapping
 * DB_DRIVER=postgres only requires a sibling file with the same surface.
 *
 * Ownership model: users -> projects -> posts. Project/post reads are always
 * scoped by user_id via joins so one account can never touch another's data.
 */
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  website         TEXT DEFAULT '',
  brand_voice     TEXT DEFAULT '',
  target_keywords TEXT DEFAULT '',
  cms_type        TEXT DEFAULT 'mock',
  cms_config      TEXT DEFAULT '',       -- ENCRYPTED JSON (AES-256-GCM)
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title            TEXT NOT NULL DEFAULT 'Untitled',
  slug             TEXT DEFAULT '',
  focus_keyword    TEXT DEFAULT '',
  content          TEXT DEFAULT '',
  meta_title       TEXT DEFAULT '',
  meta_description TEXT DEFAULT '',
  categories       TEXT DEFAULT '',       -- comma separated names
  tags             TEXT DEFAULT '',       -- comma separated names
  featured_image_url TEXT DEFAULT '',
  publish_mode     TEXT DEFAULT 'publish',-- publish | draft
  seo_score        INTEGER DEFAULT 0,
  status           TEXT DEFAULT 'draft',  -- draft | scheduled | publishing | published | failed
  scheduled_at     TEXT DEFAULT NULL,
  published_at     TEXT DEFAULT NULL,
  external_url     TEXT DEFAULT NULL,
  external_id      TEXT DEFAULT NULL,
  publish_log      TEXT DEFAULT '',
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_project ON posts(project_id);
CREATE INDEX IF NOT EXISTS idx_posts_status  ON posts(status);
`);

// ---- helpers ----
const ready = Promise.resolve();
function hydrateProject(row) {
  if (!row) return row;
  const out = { ...row };
  out.cms_config = decryptJson(row.cms_config);
  return out;
}

// ---------- users ----------
const users = {
  async create({ email, password_hash }) {
    const info = db.prepare('INSERT INTO users (email, password_hash) VALUES (?,?)').run(email, password_hash);
    return db.prepare('SELECT id, email, created_at FROM users WHERE id=?').get(info.lastInsertRowid);
  },
  async findByEmail(email) {
    return db.prepare('SELECT * FROM users WHERE email=?').get(email) || null;
  },
  async findById(id) {
    return db.prepare('SELECT id, email, created_at FROM users WHERE id=?').get(id) || null;
  },
};

// ---------- projects ----------
const projects = {
  async list(userId) {
    const rows = db.prepare('SELECT * FROM projects WHERE user_id=? ORDER BY created_at DESC').all(userId);
    return rows.map((r) => {
      const counts = db.prepare(`
        SELECT COUNT(*) AS total,
               SUM(status='published') AS published,
               SUM(status='scheduled') AS scheduled,
               SUM(status='draft') AS draft
        FROM posts WHERE project_id=?
      `).get(r.id);
      return { ...hydrateProject(r), counts };
    });
  },
  async get(userId, id) {
    const row = db.prepare('SELECT * FROM projects WHERE id=? AND user_id=?').get(id, userId);
    return hydrateProject(row);
  },
  // system-level fetch (scheduler/publisher) — not user scoped
  async getById(id) {
    return hydrateProject(db.prepare('SELECT * FROM projects WHERE id=?').get(id));
  },
  async create(userId, d) {
    const info = db.prepare(`
      INSERT INTO projects (user_id, name, website, brand_voice, target_keywords, cms_type, cms_config)
      VALUES (?,?,?,?,?,?,?)
    `).run(userId, d.name, d.website || '', d.brand_voice || '', d.target_keywords || '',
      d.cms_type || 'mock', encryptJson(d.cms_config || {}));
    return this.get(userId, info.lastInsertRowid);
  },
  async update(userId, id, d) {
    const existing = await this.get(userId, id);
    if (!existing) return null;
    // merge config, preserving secrets that came back masked
    const merged = { ...existing.cms_config };
    if (d.cms_config && typeof d.cms_config === 'object') {
      for (const [k, v] of Object.entries(d.cms_config)) {
        if (v === '••••••••') continue;
        merged[k] = v;
      }
    }
    db.prepare(`
      UPDATE projects SET name=?, website=?, brand_voice=?, target_keywords=?, cms_type=?, cms_config=?
      WHERE id=? AND user_id=?
    `).run(
      d.name ?? existing.name, d.website ?? existing.website, d.brand_voice ?? existing.brand_voice,
      d.target_keywords ?? existing.target_keywords, d.cms_type ?? existing.cms_type,
      encryptJson(merged), id, userId
    );
    return this.get(userId, id);
  },
  async remove(userId, id) {
    db.prepare('DELETE FROM projects WHERE id=? AND user_id=?').run(id, userId);
    return { ok: true };
  },
};

// ---------- posts ----------
const POST_FIELDS = ['title', 'slug', 'focus_keyword', 'content', 'meta_title', 'meta_description',
  'categories', 'tags', 'featured_image_url', 'publish_mode'];

function ownsPost(userId, postId) {
  return db.prepare(`
    SELECT p.* FROM posts p JOIN projects pr ON pr.id=p.project_id
    WHERE p.id=? AND pr.user_id=?
  `).get(postId, userId);
}

const posts = {
  async listByProject(userId, projectId) {
    const owns = db.prepare('SELECT id FROM projects WHERE id=? AND user_id=?').get(projectId, userId);
    if (!owns) return [];
    return db.prepare('SELECT * FROM posts WHERE project_id=? ORDER BY updated_at DESC').all(projectId);
  },
  async get(userId, id) {
    return ownsPost(userId, id) || null;
  },
  // system-level (scheduler/publisher)
  async getById(id) {
    return db.prepare('SELECT * FROM posts WHERE id=?').get(id) || null;
  },
  async create(userId, projectId, d) {
    const owns = db.prepare('SELECT id FROM projects WHERE id=? AND user_id=?').get(projectId, userId);
    if (!owns) throw new Error('Project not found');
    const info = db.prepare(`
      INSERT INTO posts (project_id, title, slug, focus_keyword, content, meta_title, meta_description,
        categories, tags, featured_image_url, publish_mode)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(projectId, d.title || 'Untitled', d.slug || '', d.focus_keyword || '', d.content || '',
      d.meta_title || '', d.meta_description || '', d.categories || '', d.tags || '',
      d.featured_image_url || '', d.publish_mode || 'publish');
    return this.getById(info.lastInsertRowid);
  },
  async update(userId, id, d) {
    const existing = ownsPost(userId, id);
    if (!existing) return null;
    const merged = { ...existing };
    POST_FIELDS.forEach((f) => { if (f in d) merged[f] = d[f]; });
    db.prepare(`
      UPDATE posts SET title=?, slug=?, focus_keyword=?, content=?, meta_title=?, meta_description=?,
        categories=?, tags=?, featured_image_url=?, publish_mode=?, updated_at=datetime('now')
      WHERE id=?
    `).run(merged.title, merged.slug, merged.focus_keyword, merged.content, merged.meta_title,
      merged.meta_description, merged.categories, merged.tags, merged.featured_image_url,
      merged.publish_mode, id);
    return this.getById(id);
  },
  async setSeoScore(id, score) {
    db.prepare('UPDATE posts SET seo_score=? WHERE id=?').run(score, id);
  },
  async schedule(userId, id, scheduledAtSql) {
    if (!ownsPost(userId, id)) return null;
    db.prepare(`UPDATE posts SET status='scheduled', scheduled_at=?, publish_log='', updated_at=datetime('now') WHERE id=?`)
      .run(scheduledAtSql, id);
    return this.getById(id);
  },
  async unschedule(userId, id) {
    if (!ownsPost(userId, id)) return null;
    db.prepare(`UPDATE posts SET status='draft', scheduled_at=NULL, updated_at=datetime('now') WHERE id=?`).run(id);
    return this.getById(id);
  },
  async remove(userId, id) {
    if (!ownsPost(userId, id)) return { ok: false };
    db.prepare('DELETE FROM posts WHERE id=?').run(id);
    return { ok: true };
  },

  // --- system-level publish state transitions ---
  async markPublishing(id) {
    db.prepare(`UPDATE posts SET status='publishing', updated_at=datetime('now') WHERE id=?`).run(id);
  },
  async markPublished(id, { external_url, external_id, message }) {
    db.prepare(`
      UPDATE posts SET status='published', published_at=datetime('now'),
        external_url=?, external_id=?, publish_log=?, updated_at=datetime('now')
      WHERE id=?
    `).run(external_url || null, external_id != null ? String(external_id) : null, message || 'Published.', id);
  },
  async markFailed(id, message) {
    db.prepare(`UPDATE posts SET status='failed', publish_log=?, updated_at=datetime('now') WHERE id=?`)
      .run(String(message), id);
  },
  async dueScheduled(limit = 10) {
    return db.prepare(`
      SELECT id FROM posts WHERE status='scheduled' AND scheduled_at IS NOT NULL
        AND scheduled_at <= datetime('now') ORDER BY scheduled_at ASC LIMIT ?
    `).all(limit);
  },

  // cross-project queue for a user
  async queue(userId) {
    const upcoming = db.prepare(`
      SELECT p.*, pr.name AS project_name FROM posts p JOIN projects pr ON pr.id=p.project_id
      WHERE pr.user_id=? AND p.status='scheduled' ORDER BY p.scheduled_at ASC
    `).all(userId);
    const recent = db.prepare(`
      SELECT p.*, pr.name AS project_name FROM posts p JOIN projects pr ON pr.id=p.project_id
      WHERE pr.user_id=? AND p.status IN ('published','failed') ORDER BY p.updated_at DESC LIMIT 20
    `).all(userId);
    return { upcoming, recent };
  },
};

module.exports = { ready, users, projects, posts, _db: db };
