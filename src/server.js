'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const cfg = require('./config');
const store = require('./store');
const seo = require('./seo');
const adapters = require('./adapters');
const ai = require('./ai');
const { publishPost } = require('./publisher');
const scheduler = require('./scheduler');
const {
  hashPassword, verifyPassword, issueToken, setSessionCookie, clearSessionCookie, requireAuth,
} = require('./auth');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- helpers ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function maskProject(project) {
  const adapter = adapters.get(project.cms_type);
  const masked = { ...(project.cms_config || {}) };
  (adapter.configFields || []).forEach((f) => { if (f.secret && masked[f.key]) masked[f.key] = '••••••••'; });
  const out = { ...project };
  delete out.cms_config;            // never send raw (even decrypted) secrets
  out.cms_config_masked = masked;
  return out;
}

async function recomputeSeo(postId) {
  const post = await store.posts.getById(postId);
  const { score } = seo.analyze(post);
  await store.posts.setSeoScore(postId, score);
  return score;
}

function toSqlDatetime(iso) {
  return new Date(iso).toISOString().replace('T', ' ').replace(/\..*/, '');
}

// ---------- auth ----------
app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body || {};
  if (!EMAIL_RE.test(email || '')) return res.status(400).json({ error: 'Valid email required' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be ≥ 8 chars' });
  if (await store.users.findByEmail(email)) return res.status(409).json({ error: 'Email already registered' });
  const user = await store.users.create({ email, password_hash: await hashPassword(password) });
  setSessionCookie(res, issueToken(user));
  res.status(201).json({ id: user.id, email: user.email });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = await store.users.findByEmail(email || '');
  if (!user || !(await verifyPassword(password || '', user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  setSessionCookie(res, issueToken(user));
  res.json({ id: user.id, email: user.email });
});

app.post('/api/auth/logout', (req, res) => { clearSessionCookie(res); res.json({ ok: true }); });

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ id: req.user.id, email: req.user.email });
});

// Everything below requires auth.
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth') || req.path === '/health') return next();
  return requireAuth(req, res, next);
});

// ---------- meta ----------
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/api/adapters', (req, res) => res.json(adapters.list()));
app.get('/api/capabilities', (req, res) => res.json({
  llm: cfg.anthropicApiKey ? cfg.anthropicModel : null,
  warnings: cfg.warnings,
}));

// ---------- projects ----------
app.get('/api/projects', async (req, res) => {
  const rows = await store.projects.list(req.user.id);
  res.json(rows.map(maskProject));
});

app.get('/api/projects/:id', async (req, res) => {
  const p = await store.projects.get(req.user.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(maskProject(p));
});

app.post('/api/projects', async (req, res) => {
  if (!req.body.name) return res.status(400).json({ error: 'name is required' });
  const p = await store.projects.create(req.user.id, req.body);
  res.status(201).json(maskProject(p));
});

app.put('/api/projects/:id', async (req, res) => {
  const p = await store.projects.update(req.user.id, req.params.id, req.body);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(maskProject(p));
});

app.delete('/api/projects/:id', async (req, res) => {
  await store.projects.remove(req.user.id, req.params.id);
  res.json({ ok: true });
});

app.post('/api/projects/:id/test-connection', async (req, res) => {
  const p = await store.projects.get(req.user.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const adapter = adapters.get(p.cms_type);
  try { res.json(await adapter.validate(p.cms_config || {})); }
  catch (e) { res.json({ ok: false, message: String(e.message || e) }); }
});

// ---------- posts ----------
app.get('/api/projects/:id/posts', async (req, res) => {
  res.json(await store.posts.listByProject(req.user.id, req.params.id));
});

app.get('/api/posts/:id', async (req, res) => {
  const post = await store.posts.get(req.user.id, req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  res.json({ ...post, analysis: seo.analyze(post) });
});

app.post('/api/posts', async (req, res) => {
  const { project_id } = req.body || {};
  if (!project_id) return res.status(400).json({ error: 'project_id is required' });
  try {
    const post = await store.posts.create(req.user.id, project_id, req.body);
    await recomputeSeo(post.id);
    res.status(201).json(await store.posts.getById(post.id));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/posts/:id', async (req, res) => {
  const updated = await store.posts.update(req.user.id, req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  await recomputeSeo(updated.id);
  const post = await store.posts.getById(updated.id);
  res.json({ ...post, analysis: seo.analyze(post) });
});

app.delete('/api/posts/:id', async (req, res) => {
  res.json(await store.posts.remove(req.user.id, req.params.id));
});

app.get('/api/posts/:id/analyze', async (req, res) => {
  const post = await store.posts.get(req.user.id, req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  res.json(seo.analyze(post));
});

app.post('/api/posts/:id/autofill', async (req, res) => {
  const post = await store.posts.get(req.user.id, req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  const patch = seo.autofill(post);
  const updated = await store.posts.update(req.user.id, req.params.id, patch);
  await recomputeSeo(updated.id);
  const fresh = await store.posts.getById(updated.id);
  res.json({ ...fresh, analysis: seo.analyze(fresh), patch });
});

app.post('/api/posts/:id/schedule', async (req, res) => {
  const { scheduled_at } = req.body || {};
  if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at is required' });
  const updated = await store.posts.schedule(req.user.id, req.params.id, toSqlDatetime(scheduled_at));
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
});

app.post('/api/posts/:id/unschedule', async (req, res) => {
  const updated = await store.posts.unschedule(req.user.id, req.params.id);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
});

app.post('/api/posts/:id/publish', async (req, res) => {
  const post = await store.posts.get(req.user.id, req.params.id); // ownership check
  if (!post) return res.status(404).json({ error: 'Not found' });
  const result = await publishPost(post.id);
  res.json({ ...result, post: await store.posts.getById(post.id) });
});

// ---------- generation ----------
app.post('/api/generate', async (req, res) => {
  const { project_id, topic, keyword } = req.body || {};
  if (!project_id) return res.status(400).json({ error: 'project_id is required' });
  const project = await store.projects.get(req.user.id, project_id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  try {
    const draft = await ai.generate({
      topic, keyword, brandVoice: project.brand_voice,
      projectName: project.name, targetKeywords: project.target_keywords,
    });
    const post = await store.posts.create(req.user.id, project_id, draft);
    await recomputeSeo(post.id);
    res.status(201).json({ ...(await store.posts.getById(post.id)), source: draft.source });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- queue ----------
app.get('/api/queue', async (req, res) => {
  const q = await store.posts.queue(req.user.id);
  res.json({ ...q, now: new Date().toISOString() });
});

store.ready.then(() => {
  app.listen(cfg.port, () => {
    console.log(`\n  Blog Automation Platform → http://localhost:${cfg.port}`);
    if (cfg.warnings.length) cfg.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
    console.log('');
    scheduler.start();
  });
});
