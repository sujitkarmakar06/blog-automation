'use strict';

/**
 * WordPress adapter — publishes via the WordPress REST API using an
 * Application Password (WP Admin → Users → Profile → Application Passwords).
 *
 * Supports: HTML body, slug, excerpt (meta description), publish vs draft,
 * category + tag resolution (get-or-create by name), and featured image
 * upload from a URL.
 *
 * cms_config: { site_url, username, app_password }
 */

function miniMarkdownToHtml(md) {
  if (!md) return '';
  if (/<\/?[a-z][\s\S]*>/i.test(md) && /<(p|h[1-6]|ul|ol|img|a)\b/i.test(md)) return md;
  const lines = String(md).split(/\r?\n/);
  const out = [];
  let inList = false;
  const inline = (s) =>
    s
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" />')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const li = line.match(/^[-*]\s+(.*)$/);
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (h) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    } else if (li || ol) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline((li || ol)[1])}</li>`);
    } else if (line === '') {
      if (inList) { out.push('</ul>'); inList = false; }
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

function authHeader(config) {
  return 'Basic ' + Buffer.from(`${config.username}:${config.app_password}`).toString('base64');
}

async function wpFetch(config, apiPath, options = {}) {
  const base = String(config.site_url || '').replace(/\/$/, '');
  const res = await fetch(`${base}/wp-json/wp/v2${apiPath}`, {
    ...options,
    headers: { Authorization: authHeader(config), ...(options.headers || {}) },
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const msg = body && body.message ? body.message : `HTTP ${res.status}`;
    throw new Error(`WordPress API error: ${msg}`);
  }
  return body;
}

// Resolve a comma-separated list of term names to IDs, creating any missing.
async function resolveTerms(config, taxonomy, csv) {
  const names = String(csv || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ids = [];
  for (const name of names) {
    const found = await wpFetch(config, `/${taxonomy}?search=${encodeURIComponent(name)}`);
    const exact = Array.isArray(found) ? found.find((t) => t.name.toLowerCase() === name.toLowerCase()) : null;
    if (exact) { ids.push(exact.id); continue; }
    const created = await wpFetch(config, `/${taxonomy}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    ids.push(created.id);
  }
  return ids;
}

// Download an image URL and upload it to the WP media library; return media ID.
async function uploadFeaturedImage(config, imageUrl) {
  const base = String(config.site_url || '').replace(/\/$/, '');
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Could not fetch featured image (${imgRes.status})`);
  const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const ext = (contentType.split('/')[1] || 'jpg').split(';')[0];
  const filename = `featured-${Date.now()}.${ext}`;
  const up = await fetch(`${base}/wp-json/wp/v2/media`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(config),
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
    body: buf,
  });
  const body = await up.json().catch(() => ({}));
  if (!up.ok) throw new Error(`Media upload failed: ${body.message || up.status}`);
  return body.id;
}

module.exports = {
  id: 'wordpress',
  label: 'WordPress (REST API + Application Password)',
  configFields: [
    { key: 'site_url', label: 'Site URL', placeholder: 'https://blog.example.com' },
    { key: 'username', label: 'Username', placeholder: 'editor' },
    { key: 'app_password', label: 'Application Password', placeholder: 'xxxx xxxx xxxx xxxx', secret: true },
  ],

  async validate(config) {
    if (!config || !config.site_url || !config.username || !config.app_password) {
      return { ok: false, message: 'site_url, username and app_password are required.' };
    }
    try {
      const me = await wpFetch(config, '/users/me?context=edit');
      return { ok: true, message: `Connected as ${me.name || config.username}.` };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  },

  async publish(post, config) {
    const [categoryIds, tagIds] = await Promise.all([
      resolveTerms(config, 'categories', post.categories),
      resolveTerms(config, 'tags', post.tags),
    ]);

    let featuredMedia;
    if (post.featured_image_url) {
      featuredMedia = await uploadFeaturedImage(config, post.featured_image_url);
    }

    const payload = {
      title: post.meta_title || post.title,
      slug: post.slug || undefined,
      content: miniMarkdownToHtml(post.content),
      excerpt: post.meta_description || undefined,
      status: post.publish_mode === 'draft' ? 'draft' : 'publish',
      categories: categoryIds.length ? categoryIds : undefined,
      tags: tagIds.length ? tagIds : undefined,
      featured_media: featuredMedia,
    };

    const created = await wpFetch(config, '/posts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return {
      ok: true,
      external_url: created.link,
      external_id: created.id,
      message: `Published to WordPress as ${payload.status} (post #${created.id}).`,
    };
  },
};
