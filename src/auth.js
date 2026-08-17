'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const store = require('./store');
const { jwtSecret, sessionDays } = require('./config');

const COOKIE = 'ba_session';

async function hashPassword(pw) {
  return bcrypt.hash(pw, 10);
}
async function verifyPassword(pw, hash) {
  return bcrypt.compare(pw, hash);
}

function issueToken(user) {
  return jwt.sign({ uid: user.id, email: user.email }, jwtSecret, { expiresIn: `${sessionDays}d` });
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: sessionDays * 24 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE);
}

// Express middleware — attaches req.user or 401s.
async function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, jwtSecret);
    const user = await store.users.findById(payload.uid);
    if (!user) return res.status(401).json({ error: 'Session invalid' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired' });
  }
}

module.exports = {
  hashPassword, verifyPassword, issueToken, setSessionCookie, clearSessionCookie, requireAuth, COOKIE,
};
