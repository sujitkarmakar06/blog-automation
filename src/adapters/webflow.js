'use strict';

/**
 * Webflow CMS adapter (STUB / example).
 * Publishing to Webflow means creating a CMS Collection item via the
 * Data API v2, then publishing the site. Wire your collection field
 * mappings here.
 *
 * cms_config: { "api_token": "...", "collection_id": "...", "site_id": "..." }
 */
module.exports = {
  id: 'webflow',
  label: 'Webflow (CMS API v2) — stub',
  configFields: [
    { key: 'api_token', label: 'API Token', placeholder: 'Bearer token', secret: true },
    { key: 'collection_id', label: 'Collection ID', placeholder: '650...' },
    { key: 'site_id', label: 'Site ID', placeholder: '650...' },
  ],

  async validate(config) {
    if (!config || !config.api_token || !config.collection_id) {
      return { ok: false, message: 'api_token and collection_id are required.' };
    }
    return { ok: true, message: 'Config looks valid (stub — no live call made).' };
  },

  async publish() {
    // Implement: POST https://api.webflow.com/v2/collections/{id}/items,
    // then POST /sites/{site_id}/publish
    throw new Error(
      'Webflow adapter is a stub. Implement Data API v2 item create + site publish to enable.'
    );
  },
};
