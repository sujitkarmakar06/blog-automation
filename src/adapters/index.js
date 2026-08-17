'use strict';

/**
 * Adapter registry. Add a new CMS by dropping a module in this folder that
 * exports { id, label, configFields, validate(config), publish(post, config) }
 * and registering it here.
 */
const mock = require('./mock');
const wordpress = require('./wordpress');
const ghost = require('./ghost');
const webflow = require('./webflow');

const adapters = { mock, wordpress, ghost, webflow };

function get(type) {
  return adapters[type] || adapters.mock;
}

function list() {
  return Object.values(adapters).map((a) => ({
    id: a.id,
    label: a.label,
    configFields: a.configFields || [],
  }));
}

module.exports = { get, list, adapters };
