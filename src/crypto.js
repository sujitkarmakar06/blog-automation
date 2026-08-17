'use strict';

const crypto = require('crypto');
const { encryptionKey } = require('./config');

/**
 * AES-256-GCM encryption for secrets at rest (CMS credentials).
 * Key is derived from APP_ENCRYPTION_KEY via scrypt so any-length passphrase works.
 * Format: "enc:v1:" + base64(iv[12] | authTag[16] | ciphertext)
 */
const KEY = crypto.scryptSync(encryptionKey, 'blog-automation-salt', 32);
const PREFIX = 'enc:v1:';

function encrypt(plaintext) {
  if (plaintext == null) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(payload) {
  if (typeof payload !== 'string' || !payload.startsWith(PREFIX)) return payload; // not encrypted
  const raw = Buffer.from(payload.slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// Convenience for JSON config blobs
function encryptJson(obj) { return encrypt(JSON.stringify(obj || {})); }
function decryptJson(payload) {
  try { return JSON.parse(decrypt(payload) || '{}'); } catch { return {}; }
}

module.exports = { encrypt, decrypt, encryptJson, decryptJson };
