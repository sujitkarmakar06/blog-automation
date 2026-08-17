'use strict';

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth')) { showAuth(); throw new Error('Please log in'); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg, kind = '') {
  const t = el(`<div class="toast ${kind}">${esc(msg)}</div>`);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
function seoClass(s) { return s >= 80 ? 'good' : s >= 50 ? 'mid' : 'bad'; }
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const state = { adapters: [], projects: [], currentProjectId: null, user: null, caps: {} };

// ================= AUTH =================
function showAuth() {
  $('#auth-screen').classList.remove('hidden');
  $('#app').style.display = 'none';
}
function showApp() {
  $('#auth-screen').classList.add('hidden');
  $('#app').style.display = '';
}

function initAuthScreen() {
  let mode = 'login';
  const setMode = (m) => {
    mode = m;
    $$('.auth-tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === m));
    $('#auth-submit').textContent = m === 'login' ? 'Log in' : 'Create account';
    $('#auth-error').textContent = '';
  };
  $$('.auth-tab').forEach((t) => (t.onclick = () => setMode(t.dataset.mode)));
  const submit = async () => {
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value;
    $('#auth-error').textContent = '';
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/signup';
      const user = await api(path, { method: 'POST', body: { email, password } });
      state.user = user;
      showApp();
      await boot();
    } catch (e) { $('#auth-error').textContent = e.message; }
  };
  $('#auth-submit').onclick = submit;
  $('#auth-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

function renderUserArea() {
  const area = $('#user-area');
  area.innerHTML = '';
  if (!state.user) return;
  area.appendChild(el(`<span class="email">${esc(state.user.email)}</span>`));
  const btn = el(`<button class="btn ghost small">Log out</button>`);
  btn.onclick = async () => { await api('/auth/logout', { method: 'POST' }); state.user = null; showAuth(); };
  area.appendChild(btn);
}

// ================= MODAL =================
function openModal(title, sub, bodyNode, onSubmit, submitLabel = 'Save', wide = false) {
  const root = $('#modal-root');
  root.innerHTML = '';
  const backdrop = el(`<div class="modal-backdrop"></div>`);
  const modal = el(`<div class="modal ${wide ? 'wide' : ''}">
    <h2>${esc(title)}</h2>
    <p class="modal-sub">${esc(sub)}</p>
    <div class="modal-body"></div>
    <div class="modal-actions">
      <button class="btn ghost" data-act="cancel">Cancel</button>
      <button class="btn" data-act="ok">${esc(submitLabel)}</button>
    </div>
  </div>`);
  $('.modal-body', modal).appendChild(bodyNode);
  backdrop.appendChild(modal);
  root.appendChild(backdrop);
  const close = () => (root.innerHTML = '');
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  $('[data-act=cancel]', modal).onclick = close;
  $('[data-act=ok]', modal).onclick = async () => {
    try { await onSubmit(close); } catch (e) { toast(e.message, 'err'); }
  };
  return close;
}

// ================= PROJECTS =================
async function loadProjects() {
  state.projects = await api('/projects');
  renderProjectList();
  if (state.currentProjectId && state.projects.find((p) => p.id === state.currentProjectId)) {
    renderProjectDetail(state.currentProjectId);
  } else if (state.projects.length) {
    selectProject(state.projects[0].id);
  } else {
    $('#project-empty').classList.remove('hidden');
    $('#project-detail').classList.add('hidden');
  }
}

function renderProjectList() {
  const list = $('#project-list');
  list.innerHTML = '';
  if (!state.projects.length) list.appendChild(el(`<p class="hint">No projects yet.</p>`));
  state.projects.forEach((p) => {
    const c = p.counts || {};
    const item = el(`<li class="project-item ${p.id === state.currentProjectId ? 'active' : ''}">
      <h3>${esc(p.name)}</h3>
      <div class="meta">${esc(p.cms_type)} · ${c.total || 0} posts</div>
      <div class="pill-row">
        ${c.published ? `<span class="pill green">${c.published} live</span>` : ''}
        ${c.scheduled ? `<span class="pill amber">${c.scheduled} scheduled</span>` : ''}
        ${c.draft ? `<span class="pill">${c.draft} draft</span>` : ''}
      </div>
    </li>`);
    item.onclick = () => selectProject(p.id);
    list.appendChild(item);
  });
}

function selectProject(id) { state.currentProjectId = id; renderProjectList(); renderProjectDetail(id); }

async function renderProjectDetail(id) {
  $('#project-empty').classList.add('hidden');
  const host = $('#project-detail');
  host.classList.remove('hidden');
  const project = await api('/projects/' + id);
  const posts = await api(`/projects/${id}/posts`);

  host.innerHTML = '';
  host.appendChild(el(`<div class="detail-head">
    <div>
      <h2>${esc(project.name)}</h2>
      <div class="detail-sub">
        ${project.website ? esc(project.website) + ' · ' : ''}CMS: <strong>${esc(project.cms_type)}</strong>
        ${project.brand_voice ? ' · voice: ' + esc(project.brand_voice) : ''}
      </div>
    </div>
    <div class="btn-row">
      <button class="btn ghost small" id="btn-test">Test connection</button>
      <button class="btn ghost small" id="btn-edit-project">Settings</button>
      <button class="btn small" id="btn-generate">✦ Generate draft</button>
      <button class="btn small" id="btn-new-post">+ New post</button>
    </div>
  </div>`));

  if (project.target_keywords) {
    host.appendChild(el(`<div class="card"><h3>Target keywords</h3>
      <div class="pill-row">${project.target_keywords.split(',').map((k) => `<span class="pill">${esc(k.trim())}</span>`).join('')}</div>
    </div>`));
  }

  const postsCard = el(`<div class="card"><h3>Posts (${posts.length})</h3><div class="posts"></div></div>`);
  const wrap = $('.posts', postsCard);
  if (!posts.length) wrap.appendChild(el(`<p class="hint">No posts yet. Generate a draft or create one.</p>`));
  posts.forEach((post) => {
    const row = el(`<div class="post-row">
      <div>
        <div class="post-title">${esc(post.title)}</div>
        <div class="post-kw">${post.focus_keyword ? '⌖ ' + esc(post.focus_keyword) : 'no focus keyword'} ${post.scheduled_at ? '· ⏱ ' + fmtDate(post.scheduled_at) : ''}</div>
      </div>
      <span class="seo-badge ${seoClass(post.seo_score)}">SEO ${post.seo_score}</span>
      <span class="status ${post.status}">${post.status}</span>
      <button class="btn ghost small" data-open="${post.id}">Open</button>
    </div>`);
    $('[data-open]', row).onclick = () => openPostEditor(post.id);
    wrap.appendChild(row);
  });
  host.appendChild(postsCard);

  $('#btn-new-post', host).onclick = () => createPost(id);
  $('#btn-generate', host).onclick = () => generateDraft(id);
  $('#btn-edit-project', host).onclick = () => projectForm(project);
  $('#btn-test', host).onclick = async () => {
    toast('Testing connection…');
    const r = await api(`/projects/${id}/test-connection`, { method: 'POST' });
    toast(r.message, r.ok ? 'ok' : 'err');
  };
}

function adapterFields(cmsType, config = {}) {
  const adapter = state.adapters.find((a) => a.id === cmsType);
  if (!adapter || !adapter.configFields.length) return `<p class="hint">This adapter needs no configuration.</p>`;
  return adapter.configFields.map((f) => `
    <label>${esc(f.label)}</label>
    <input data-cfg="${esc(f.key)}" type="${f.secret ? 'password' : 'text'}"
      value="${esc(config[f.key] || '')}" placeholder="${esc(f.placeholder || '')}" />
  `).join('');
}

function projectForm(existing = null) {
  const body = el(`<div>
    <label>Project name *</label>
    <input id="f-name" value="${esc(existing?.name || '')}" placeholder="Acme Corp Blog" />
    <div class="grid-2">
      <div><label>Website</label><input id="f-web" value="${esc(existing?.website || '')}" placeholder="https://acme.com" /></div>
      <div><label>Brand voice</label><input id="f-voice" value="${esc(existing?.brand_voice || '')}" placeholder="friendly, expert" /></div>
    </div>
    <label>Target keywords (comma separated)</label>
    <input id="f-kw" value="${esc(existing?.target_keywords || '')}" placeholder="saas onboarding, product analytics" />
    <label>CMS / publishing target</label>
    <select id="f-cms"></select>
    <div id="f-cms-fields" style="margin-top:6px"></div>
  </div>`);
  const sel = $('#f-cms', body);
  state.adapters.forEach((a) => sel.appendChild(el(`<option value="${a.id}">${esc(a.label)}</option>`)));
  sel.value = existing?.cms_type || 'mock';
  const cfg = existing?.cms_config_masked || {};
  const renderFields = () => { $('#f-cms-fields', body).innerHTML = adapterFields(sel.value, cfg); };
  renderFields(); sel.onchange = renderFields;

  openModal(existing ? 'Project settings' : 'New project',
    'Each project has its own brand voice, keywords and publishing target. Credentials are encrypted at rest.',
    body, async (close) => {
      const config = {};
      $$('[data-cfg]', body).forEach((i) => { if (i.value) config[i.dataset.cfg] = i.value; });
      const payload = {
        name: $('#f-name', body).value.trim(), website: $('#f-web', body).value.trim(),
        brand_voice: $('#f-voice', body).value.trim(), target_keywords: $('#f-kw', body).value.trim(),
        cms_type: sel.value, cms_config: config,
      };
      if (!payload.name) throw new Error('Project name is required');
      if (existing) await api('/projects/' + existing.id, { method: 'PUT', body: payload });
      else { const c = await api('/projects', { method: 'POST', body: payload }); state.currentProjectId = c.id; }
      close(); await loadProjects(); toast('Project saved', 'ok');
    });
}

async function createPost(projectId) {
  const created = await api('/posts', { method: 'POST', body: { project_id: projectId, title: 'Untitled post' } });
  await renderProjectDetail(projectId);
  openPostEditor(created.id);
}

async function generateDraft(projectId) {
  const llm = state.caps.llm ? `Using <strong>${esc(state.caps.llm)}</strong>.` : 'Using the offline template (set ANTHROPIC_API_KEY for Claude).';
  const body = el(`<div>
    <label>Topic / working title</label>
    <input id="g-topic" placeholder="How to reduce SaaS churn" />
    <label>Focus keyword</label>
    <input id="g-kw" placeholder="reduce saas churn" />
    <p class="hint">${llm} Generates a structured, SEO-shaped draft you can edit.</p>
  </div>`);
  openModal('Generate draft', 'Create a first draft to edit and optimize.', body, async (close) => {
    const topic = $('#g-topic', body).value.trim();
    const keyword = $('#g-kw', body).value.trim();
    if (!topic && !keyword) throw new Error('Enter a topic or keyword');
    const btn = $('#modal-root [data-act=ok]'); btn.textContent = 'Generating…'; btn.disabled = true;
    try {
      const created = await api('/generate', { method: 'POST', body: { project_id: projectId, topic, keyword } });
      close(); await renderProjectDetail(projectId); openPostEditor(created.id);
      toast('Draft generated · ' + (created.source || ''), 'ok');
    } finally { if (btn) { btn.textContent = 'Generate'; btn.disabled = false; } }
  }, 'Generate');
}

// ================= POST EDITOR =================
async function openPostEditor(postId) {
  const post = await api('/posts/' + postId);
  const body = el(`<div>
    <div class="grid-editor">
      <div>
        <label>Title <span class="char" id="c-title"></span></label>
        <input id="e-title" value="${esc(post.title)}" />
        <div class="grid-2">
          <div><label>Focus keyword</label><input id="e-kw" value="${esc(post.focus_keyword)}" /></div>
          <div><label>Slug</label><input id="e-slug" value="${esc(post.slug)}" /></div>
        </div>
        <label>Meta title <span class="char" id="c-mt"></span></label>
        <input id="e-mt" value="${esc(post.meta_title)}" />
        <label>Meta description <span class="char" id="c-md"></span></label>
        <textarea id="e-md" style="min-height:56px">${esc(post.meta_description)}</textarea>
        <div class="grid-2">
          <div><label>Categories (comma sep)</label><input id="e-cats" value="${esc(post.categories)}" placeholder="Guides, SEO" /></div>
          <div><label>Tags (comma sep)</label><input id="e-tags" value="${esc(post.tags)}" placeholder="churn, saas" /></div>
        </div>
        <label>Featured image URL</label>
        <input id="e-img" value="${esc(post.featured_image_url)}" placeholder="https://…/cover.jpg" />
        <label>Publish mode</label>
        <div class="toggle" id="e-mode">
          <button type="button" data-mode="publish">Publish live</button>
          <button type="button" data-mode="draft">Save as draft</button>
        </div>
        <label>Content (Markdown)</label>
        <textarea id="e-content" style="min-height:230px">${esc(post.content)}</textarea>
      </div>
      <div>
        <div class="card" style="margin:0 0 12px">
          <div class="score-ring"><div class="score-num" id="seo-num">–</div><div class="score-lbl">SEO score</div></div>
          <button class="btn ghost small" id="btn-autofill" style="width:100%">✦ Auto-fill meta &amp; slug</button>
          <ul class="checks" id="seo-checks" style="margin-top:12px"></ul>
        </div>
      </div>
    </div>
  </div>`);

  const F = {
    title: $('#e-title', body), kw: $('#e-kw', body), slug: $('#e-slug', body), mt: $('#e-mt', body),
    md: $('#e-md', body), cats: $('#e-cats', body), tags: $('#e-tags', body), img: $('#e-img', body),
    content: $('#e-content', body),
  };
  let publishMode = post.publish_mode || 'publish';
  const modeBtns = $$('#e-mode button', body);
  const paintMode = () => modeBtns.forEach((b) => b.classList.toggle('active', b.dataset.mode === publishMode));
  modeBtns.forEach((b) => (b.onclick = () => { publishMode = b.dataset.mode; paintMode(); onInput(); }));
  paintMode();

  const collect = () => ({
    title: F.title.value, focus_keyword: F.kw.value, slug: F.slug.value, meta_title: F.mt.value,
    meta_description: F.md.value, categories: F.cats.value, tags: F.tags.value,
    featured_image_url: F.img.value, publish_mode: publishMode, content: F.content.value,
  });

  const renderSeo = (a) => {
    $('#c-title', body).textContent = F.title.value.length;
    $('#c-mt', body).textContent = F.mt.value.length;
    $('#c-md', body).textContent = F.md.value.length;
    const num = $('#seo-num', body); num.textContent = a.score;
    num.style.color = a.score >= 80 ? 'var(--green)' : a.score >= 50 ? 'var(--amber)' : 'var(--red)';
    const ul = $('#seo-checks', body); ul.innerHTML = '';
    a.checks.forEach((c) => ul.appendChild(el(`<li class="check ${c.ok ? 'ok' : 'no'}">
      <span class="mark">${c.ok ? '✓' : '!'}</span>
      <span class="lbl">${esc(c.label)}${c.ok ? '' : `<div class="hint-txt">${esc(c.hint)}</div>`}</span>
    </li>`)));
  };

  let saveTimer = null;
  const persistAndAnalyze = async () => {
    const updated = await api('/posts/' + postId, { method: 'PUT', body: collect() });
    renderSeo(updated.analysis);
  };
  const onInput = () => { clearTimeout(saveTimer); saveTimer = setTimeout(persistAndAnalyze, 500); };
  Object.values(F).forEach((f) => f.addEventListener('input', onInput));
  renderSeo(post.analysis);

  $('#btn-autofill', body).onclick = async () => {
    await api('/posts/' + postId, { method: 'PUT', body: collect() });
    const r = await api(`/posts/${postId}/autofill`, { method: 'POST' });
    F.slug.value = r.slug; F.mt.value = r.meta_title; F.md.value = r.meta_description;
    renderSeo(r.analysis); toast('Auto-filled meta & slug', 'ok');
  };

  const close = openModal('Edit post', `Status: ${post.status} · updated ${fmtDate(post.updated_at)}`, body,
    async (c) => { await persistAndAnalyze(); c(); await renderProjectDetail(post.project_id); toast('Saved', 'ok'); },
    'Save & close', true);

  const actions = $('.modal-actions', $('#modal-root'));
  const scheduleBtn = el(`<button class="btn ghost">⏱ Schedule</button>`);
  const publishBtn = el(`<button class="btn">▲ Publish now</button>`);
  const delBtn = el(`<button class="btn danger">Delete</button>`);
  actions.prepend(publishBtn); actions.prepend(scheduleBtn); actions.prepend(delBtn);

  publishBtn.onclick = async () => {
    await persistAndAnalyze(); toast('Publishing…');
    const r = await api(`/posts/${postId}/publish`, { method: 'POST' });
    toast(r.ok ? (r.message || 'Published') : ('Failed: ' + r.message), r.ok ? 'ok' : 'err');
    close(); await renderProjectDetail(post.project_id);
  };
  scheduleBtn.onclick = async () => { await persistAndAnalyze(); scheduleModal(postId, post.project_id); };
  delBtn.onclick = async () => {
    if (!confirm('Delete this post?')) return;
    await api('/posts/' + postId, { method: 'DELETE' });
    close(); await renderProjectDetail(post.project_id); toast('Deleted', 'ok');
  };
}

function scheduleModal(postId, projectId) {
  const d = new Date(Date.now() + 2 * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const body = el(`<div>
    <label>Publish date &amp; time (your local time)</label>
    <input id="s-when" type="datetime-local" value="${local}" />
    <p class="hint">The scheduler polls every 15s and auto-publishes when due. Try ~1–2 minutes out to watch it fire.</p>
  </div>`);
  openModal('Schedule post', 'Queue this post for automatic publishing.', body, async (close) => {
    const val = $('#s-when', body).value;
    if (!val) throw new Error('Pick a date & time');
    await api(`/posts/${postId}/schedule`, { method: 'POST', body: { scheduled_at: new Date(val).toISOString() } });
    close(); await renderProjectDetail(projectId); toast('Scheduled', 'ok');
  }, 'Schedule');
}

// ================= QUEUE =================
async function renderQueue() {
  const wrap = $('#queue-wrap');
  wrap.innerHTML = '<p class="hint">Loading…</p>';
  const q = await api('/queue');
  wrap.innerHTML = '';
  wrap.appendChild(el(`<h2 style="margin-bottom:16px">Publish Queue <span class="hint" style="font-weight:400">· server time ${fmtDate(q.now)}</span></h2>`));
  const grid = el(`<div class="queue-grid">
    <div class="queue-col"><h2>⏱ Upcoming (${q.upcoming.length})</h2><div id="q-up"></div></div>
    <div class="queue-col"><h2>✓ Recent (${q.recent.length})</h2><div id="q-recent"></div></div>
  </div>`);
  wrap.appendChild(grid);
  const up = $('#q-up', grid), rec = $('#q-recent', grid);
  if (!q.upcoming.length) up.appendChild(el(`<p class="hint">Nothing scheduled.</p>`));
  q.upcoming.forEach((p) => up.appendChild(el(`<div class="q-item">
    <div class="q-top"><strong>${esc(p.title)}</strong><span class="status scheduled">scheduled</span></div>
    <div class="q-meta">${esc(p.project_name)} · fires ${fmtDate(p.scheduled_at)}</div>
  </div>`)));
  if (!q.recent.length) rec.appendChild(el(`<p class="hint">Nothing published yet.</p>`));
  q.recent.forEach((p) => rec.appendChild(el(`<div class="q-item">
    <div class="q-top"><strong>${esc(p.title)}</strong><span class="status ${p.status}">${p.status}</span></div>
    <div class="q-meta">${esc(p.project_name)} · ${fmtDate(p.published_at || p.updated_at)}
      ${p.external_url ? `· <a href="${esc(p.external_url)}" target="_blank">view ↗</a>` : ''}
      ${p.status === 'failed' ? `· <span style="color:var(--red)">${esc(p.publish_log)}</span>` : ''}
    </div>
  </div>`)));
}

// ================= NAV / BOOT =================
function switchView(view) {
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#view-projects').classList.toggle('hidden', view !== 'projects');
  $('#view-queue').classList.toggle('hidden', view !== 'queue');
  if (view === 'queue') renderQueue();
  if (view === 'projects') loadProjects();
}

async function boot() {
  renderUserArea();
  state.adapters = await api('/adapters');
  state.caps = await api('/capabilities');
  await loadProjects();
}

async function init() {
  initAuthScreen();
  $$('.nav-btn').forEach((b) => (b.onclick = () => switchView(b.dataset.view)));
  $('#btn-new-project').onclick = () => projectForm();
  setInterval(() => { if (state.user && !$('#view-queue').classList.contains('hidden')) renderQueue(); }, 8000);
  try {
    state.user = await api('/auth/me');
    showApp(); await boot();
  } catch { showAuth(); }
}

init();
