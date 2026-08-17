'use strict';

/**
 * Mock adapter — the default. Lets the whole platform run end-to-end with
 * zero external credentials, so you can demo scheduling + publishing offline.
 * It "publishes" by returning a fake URL.
 */
module.exports = {
  id: 'mock',
  label: 'Mock (no external CMS — for testing)',
  // Fields the UI should render for cms_config. Mock needs none.
  configFields: [],

  async validate() {
    return { ok: true, message: 'Mock adapter is always ready.' };
  },

  async publish(post, config) {
    const base = (config && config.site_url) || 'https://example.com';
    const slug = post.slug || 'post-' + post.id;
    const mode = post.publish_mode === 'draft' ? 'draft' : 'published';
    const extras = [];
    if (post.categories) extras.push(`categories: ${post.categories}`);
    if (post.tags) extras.push(`tags: ${post.tags}`);
    if (post.featured_image_url) extras.push('featured image set');
    return {
      ok: true,
      external_url: `${base.replace(/\/$/, '')}/${slug}`,
      external_id: 'mock-' + post.id,
      message: `Mock CMS: ${mode}${extras.length ? ' (' + extras.join(', ') + ')' : ''}.`,
    };
  },
};
