'use strict';

/**
 * Store driver selector. Today only 'sqlite' ships. To add Postgres later,
 * create ./postgres.js exposing the SAME async surface (users/projects/posts
 * with identical method signatures) backed by `pg`, and switch DB_DRIVER.
 * No application code above this layer needs to change.
 */
const { dbDriver } = require('../config');

let store;
switch (dbDriver) {
  case 'postgres':
    // require('./postgres') — implement with the same interface as sqlite.js
    throw new Error('Postgres driver not implemented yet. Set DB_DRIVER=sqlite.');
  case 'sqlite':
  default:
    store = require('./sqlite');
}

module.exports = store;
