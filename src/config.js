'use strict';

/**
 * Central config, all overridable via environment (.env style).
 * Sensible dev defaults are provided so the app runs out of the box, but
 * production MUST set JWT_SECRET and APP_ENCRYPTION_KEY to strong values.
 */
const config = {
  port: parseInt(process.env.PORT || '3000', 10),

  // Auth
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-jwt-secret-change-me',
  sessionDays: parseInt(process.env.SESSION_DAYS || '7', 10),

  // Encryption for CMS credentials at rest
  encryptionKey: process.env.APP_ENCRYPTION_KEY || 'dev-insecure-encryption-key-change-me',

  // Data layer: 'sqlite' now; 'postgres' is a documented future swap
  dbDriver: process.env.DB_DRIVER || 'sqlite',
  databaseUrl: process.env.DATABASE_URL || '', // used when dbDriver=postgres

  // LLM (Anthropic Claude)
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest',
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
};

config.warnings = [];
if (config.jwtSecret.startsWith('dev-insecure')) {
  config.warnings.push('JWT_SECRET is using an insecure dev default — set it in production.');
}
if (config.encryptionKey.startsWith('dev-insecure')) {
  config.warnings.push('APP_ENCRYPTION_KEY is using an insecure dev default — set it in production.');
}
if (!config.anthropicApiKey) {
  config.warnings.push('ANTHROPIC_API_KEY not set — content generation falls back to the offline template.');
}

module.exports = config;
