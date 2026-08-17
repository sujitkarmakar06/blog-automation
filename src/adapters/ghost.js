'use strict';

/**
 * Ghost adapter (STUB / example).
 * Demonstrates how a second CMS plugs into the same interface.
 * Ghost's Admin API requires a JWT signed from the Admin API key; wire that
 * in here to make it live. Left as a guided stub so the adapter contract
 * is clear.
 *
 * cms_config: { "admin_url": "...", "admin_api_key": "id:secret" }
 */
module.exports = {
  id: 'ghost',
  label: 'Ghost (Admin API) — stub',
  configFields: [
    { key: 'admin_url', label: 'Admin URL', placeholder: 'https://blog.example.com' },
    { key: 'admin_api_key', label: 'Admin API Key', placeholder: 'id:secret', secret: true },
  ],

  async validate(config) {
    if (!config || !config.admin_url || !config.admin_api_key) {
      return { ok: false, message: 'admin_url and admin_api_key are required.' };
    }
    return { ok: true, message: 'Config looks valid (stub — no live call made).' };
  },

  async publish(post) {
    // Implement: sign a JWT from admin_api_key, POST /ghost/api/admin/posts/
    throw new Error(
      'Ghost adapter is a stub. Implement JWT signing + POST /ghost/api/admin/posts/ to enable.'
    );
  },
};
