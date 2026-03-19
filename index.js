const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const sgMail = require('@sendgrid/mail');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cookieParser());

const pool = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const JWT_ISSUER = process.env.JWT_ISSUER || 'local-dev';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'local-client';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET;
const REFRESH_TTL_DAYS = Number(process.env.REFRESH_TTL_DAYS || 30);
const VERIFY_TTL_HOURS = Number(process.env.VERIFY_TTL_HOURS || 24);
const RESET_TTL_HOURS = Number(process.env.RESET_TTL_HOURS || 1);
const LOCKOUT_THRESHOLD = Number(process.env.LOCKOUT_THRESHOLD || 5);
const LOCKOUT_WINDOW_MINUTES = Number(process.env.LOCKOUT_WINDOW_MINUTES || 15);
const LOCKOUT_DURATION_MINUTES = Number(process.env.LOCKOUT_DURATION_MINUTES || 15);
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS || 60 * 60 * 1000);
const AUTH_RATE_LIMIT_WINDOW_MS = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const AUTH_RATE_LIMIT_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX || 20);
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const USE_REFRESH_COOKIE = process.env.USE_REFRESH_COOKIE === 'true';
const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || 'refresh_token';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const COOKIE_SAMESITE = process.env.COOKIE_SAMESITE || 'lax';
const EXPOSE_REFRESH_TOKEN = process.env.EXPOSE_REFRESH_TOKEN !== 'false';
const CSRF_COOKIE_NAME = process.env.CSRF_COOKIE_NAME || 'csrf_token';
const CSRF_HEADER_NAME = process.env.CSRF_HEADER_NAME || 'x-csrf-token';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || '';
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
const SENDGRID_ENABLED = process.env.SENDGRID_ENABLED === 'true';

if (!JWT_SECRET) {
  console.error('Missing required env var: JWT_SECRET');
  process.exit(1);
}
if (!REFRESH_TOKEN_SECRET) {
  console.error('Missing required env var: REFRESH_TOKEN_SECRET');
  process.exit(1);
}
if (SENDGRID_ENABLED && (!SENDGRID_API_KEY || !SENDGRID_FROM_EMAIL)) {
  console.error('Missing required env vars for SendGrid');
  process.exit(1);
}
if (SENDGRID_ENABLED) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
function log(level, message, meta = {}) {
  const current = LEVELS[LOG_LEVEL] ?? LEVELS.info;
  const lvl = LEVELS[level] ?? LEVELS.info;
  if (lvl > current) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  console.log(JSON.stringify(entry));
}

// Request ID + basic request logging
app.use((req, res, next) => {
  const reqId = crypto.randomUUID();
  req.id = reqId;
  res.setHeader('X-Request-Id', reqId);

  const start = Date.now();
  res.on('finish', () => {
    log('info', 'request', {
      req_id: reqId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: Date.now() - start,
    });
  });

  next();
});

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPassword(password) {
  if (typeof password !== 'string') return false;
  if (password.length < 12) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[^A-Za-z0-9]/.test(password)) return false;
  const common = [
    'password',
    'password123',
    '123456789',
    'qwerty123',
    'letmein123',
    'admin123',
  ];
  if (common.includes(password.toLowerCase())) return false;
  return true;
}

function authRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    log('warn', 'auth_missing_token', { req_id: req.id });
    return res.status(401).json({ error: 'Missing token' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    req.user = payload;
    next();
  } catch (_err) {
    log('warn', 'auth_invalid_token', { req_id: req.id });
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function hashRefreshToken(token) {
  // legacy: HMAC without per-user salt
  return crypto.createHmac('sha256', REFRESH_TOKEN_SECRET).update(token).digest('hex');
}

function hashRefreshTokenLegacy(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function hashRefreshTokenWithSalt(token, salt) {
  return crypto
    .createHmac('sha256', REFRESH_TOKEN_SECRET)
    .update(`${token}:${salt}`)
    .digest('hex');
}

function hashRefreshTokenLookup(token) {
  return crypto.createHmac('sha256', REFRESH_TOKEN_SECRET).update(token).digest('hex');
}

function getRefreshTokenFromRequest(req) {
  if (USE_REFRESH_COOKIE && req.cookies && req.cookies[REFRESH_COOKIE_NAME]) {
    return req.cookies[REFRESH_COOKIE_NAME];
  }
  return req.body.refresh_token;
}

function setRefreshCookie(res, token) {
  if (!USE_REFRESH_COOKIE) return;
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: COOKIE_SAMESITE,
    secure: COOKIE_SECURE,
    path: '/',
    maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res) {
  if (!USE_REFRESH_COOKIE) return;
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
}

function setCsrfCookie(res, token) {
  if (!USE_REFRESH_COOKIE) return;
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    sameSite: COOKIE_SAMESITE,
    secure: COOKIE_SECURE,
    path: '/',
    maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearCsrfCookie(res) {
  if (!USE_REFRESH_COOKIE) return;
  res.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
}

function requireCsrf(req, res) {
  if (!USE_REFRESH_COOKIE) return true;
  const header = req.headers[CSRF_HEADER_NAME] || req.headers[CSRF_HEADER_NAME.toLowerCase()];
  const cookie = req.cookies ? req.cookies[CSRF_COOKIE_NAME] : null;
  if (!header || !cookie || header !== cookie) {
    log('warn', 'csrf_missing_or_mismatch', { req_id: req.id });
    res.status(403).json({ error: 'CSRF token invalid' });
    return false;
  }
  return true;
}

async function getUserRefreshSalt(userId, existingSalt) {
  if (existingSalt) return existingSalt;
  const result = await pool.query(
    'SELECT refresh_token_salt FROM users WHERE id = $1',
    [userId]
  );
  if (result.rows.length === 0) {
    throw new Error('User not found for refresh salt');
  }
  let salt = result.rows[0].refresh_token_salt;
  if (!salt) {
    salt = crypto.randomUUID();
    await pool.query('UPDATE users SET refresh_token_salt = $1 WHERE id = $2', [
      salt,
      userId,
    ]);
  }
  return salt;
}

async function createSession(userId, req, existingSalt) {
  const refreshToken = crypto.randomUUID();
  const salt = await getUserRefreshSalt(userId, existingSalt);
  const refreshTokenHash = hashRefreshTokenWithSalt(refreshToken, salt);
  const refreshTokenLookup = hashRefreshTokenLookup(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  const userAgent = req.headers['user-agent'] || null;
  const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;

  const result = await pool.query(
    `INSERT INTO sessions (user_id, refresh_token, refresh_token_hash, refresh_token_lookup, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [userId, refreshToken, refreshTokenHash, refreshTokenLookup, userAgent, ipAddress, expiresAt]
  );

  return { id: result.rows[0].id, refreshToken, expiresAt };
}

async function createEmailVerification(userId) {
  const token = crypto.randomUUID();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + VERIFY_TTL_HOURS * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO email_verifications (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return { token, expiresAt };
}

async function createPasswordReset(userId) {
  const token = crypto.randomUUID();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + RESET_TTL_HOURS * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return { token, expiresAt };
}

async function sendResetEmail(toEmail, token) {
  const resetLink = `${APP_BASE_URL}/reset?token=${token}`;
  if (!SENDGRID_ENABLED) {
    return { delivered: false, resetLink };
  }

  await sgMail.send({
    to: toEmail,
    from: SENDGRID_FROM_EMAIL,
    subject: 'Reset your password',
    text: `Reset your password: ${resetLink}`,
    html: `<p>Reset your password:</p><p><a href=\"${resetLink}\">${resetLink}</a></p>`,
    mailSettings: {
      sandboxMode: { enable: process.env.SENDGRID_SANDBOX_MODE === 'true' },
    },
  });

  return { delivered: true, resetLink };
}

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN, issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
  );
}

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'Server running' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/db-test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS db_time');
    res.json({ status: 'ok', db_time: result.rows[0].db_time });
  } catch (err) {
    log('error', 'db_test_error', { req_id: req.id, error: err.message, code: err.code });
    res.status(500).json({
      status: 'error',
      error: 'Database error',
      detail: err.message,
      code: err.code,
    });
  }
});

app.get('/status', async (req, res) => {
  try {
    const db = await pool.query('SELECT NOW() AS db_time');
    res.json({
      status: 'ok',
      db_time: db.rows[0].db_time,
      node_version: process.version,
      app_env: process.env.NODE_ENV || 'development',
      version: process.env.APP_VERSION || '0.0.0',
    });
  } catch (err) {
    log('error', 'status_error', { req_id: req.id, error: err.message, code: err.code });
    res.status(500).json({ status: 'error' });
  }
});

app.get('/users', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    log('error', 'users_list_error', { req_id: req.id, error: err.message, code: err.code });
    res.status(500).json({ error: 'Database error' });
  }
});

const authLimiter = rateLimit({
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Register endpoint
app.post('/register', authLimiter, async (req, res) => {
  try {
    const { email, name, password } = req.body;

    if (!email || !name || !password) {
      log('warn', 'register_missing_fields', { req_id: req.id });
      return res.status(400).json({ error: 'email, name, and password are required' });
    }
    if (!isValidEmail(email)) {
      log('warn', 'register_invalid_email', { req_id: req.id });
      return res.status(400).json({ error: 'Invalid email' });
    }
    if (!isValidPassword(password)) {
      log('warn', 'register_weak_password', { req_id: req.id });
      return res.status(400).json({
        error:
          'Password must be at least 12 characters and include uppercase, lowercase, number, and symbol',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (email, name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, created_at`,
      [email, name, hashedPassword]
    );

    const verification = await createEmailVerification(result.rows[0].id);
    res.json({ ...result.rows[0], verification_token: verification.token });
  } catch (err) {
    if (err && err.code === '23505') {
      log('warn', 'register_email_exists', { req_id: req.id });
      return res.status(409).json({ error: 'Email already exists' });
    }
    log('error', 'register_error', { req_id: req.id, error: err.message, code: err.code });
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login endpoint
app.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      log('warn', 'login_missing_fields', { req_id: req.id });
      return res.status(400).json({ error: 'email and password are required' });
    }
    if (!isValidEmail(email)) {
      log('warn', 'login_invalid_email', { req_id: req.id });
      return res.status(400).json({ error: 'Invalid email' });
    }

    const result = await pool.query(
      `SELECT id, email, name, password_hash, is_verified,
              failed_login_count, last_failed_login_at, lockout_until, refresh_token_salt
       FROM users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      log('warn', 'login_invalid_credentials', { req_id: req.id });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    if (user.lockout_until && new Date(user.lockout_until) > new Date()) {
      return res.status(423).json({
        error: 'Account locked',
        retry_after_seconds: Math.ceil(
          (new Date(user.lockout_until).getTime() - Date.now()) / 1000
        ),
      });
    }
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      log('warn', 'login_invalid_credentials', { req_id: req.id });
      const now = new Date();
      const last = user.last_failed_login_at ? new Date(user.last_failed_login_at) : null;
      const withinWindow =
        last && now.getTime() - last.getTime() <= LOCKOUT_WINDOW_MINUTES * 60 * 1000;
      const nextCount = (withinWindow ? user.failed_login_count : 0) + 1;
      const lockoutUntil =
        nextCount >= LOCKOUT_THRESHOLD
          ? new Date(now.getTime() + LOCKOUT_DURATION_MINUTES * 60 * 1000)
          : null;
      await pool.query(
        `UPDATE users
         SET failed_login_count = $1,
             last_failed_login_at = $2,
             lockout_until = $3
         WHERE id = $4`,
        [nextCount, now, lockoutUntil, user.id]
      );
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!user.is_verified) {
      log('warn', 'login_email_not_verified', { req_id: req.id });
      return res.status(403).json({ error: 'Email not verified' });
    }

    await pool.query(
      'UPDATE users SET failed_login_count = 0, last_failed_login_at = NULL, lockout_until = NULL WHERE id = $1',
      [user.id]
    );

    const accessToken = signAccessToken(user);
    const session = await createSession(user.id, req, user.refresh_token_salt);
    setRefreshCookie(res, session.refreshToken);
    if (USE_REFRESH_COOKIE) {
      const csrfToken = crypto.randomUUID();
      setCsrfCookie(res, csrfToken);
      const payload = {
        user: { id: user.id, email: user.email, name: user.name },
        access_token: accessToken,
        refresh_expires_at: session.expiresAt,
        csrf_token: csrfToken,
      };
      if (EXPOSE_REFRESH_TOKEN) {
        payload.refresh_token = session.refreshToken;
      }
      return res.json(payload);
    }

    const payload = {
      user: { id: user.id, email: user.email, name: user.name },
      access_token: accessToken,
      refresh_expires_at: session.expiresAt,
    };
    if (EXPOSE_REFRESH_TOKEN) {
      payload.refresh_token = session.refreshToken;
    }

    res.json(payload);
  } catch (err) {
    log('error', 'login_error', { req_id: req.id, error: err.message, code: err.code });
    res.status(500).json({
      error: 'Login failed',
      detail: err.message,
      code: err.code,
    });
  }
});

// Verify email
app.get('/verify', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'token is required' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const result = await pool.query(
      `SELECT id, user_id, expires_at, verified_at
       FROM email_verifications
       WHERE token_hash = $1`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid token' });
    }

    const row = result.rows[0];
    if (row.verified_at) {
      return res.status(200).json({ status: 'already verified' });
    }
    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Token expired' });
    }

    await pool.query('UPDATE users SET is_verified = TRUE WHERE id = $1', [row.user_id]);
    await pool.query(
      'UPDATE email_verifications SET verified_at = NOW() WHERE id = $1',
      [row.id]
    );

    res.json({ status: 'verified' });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({
      error: 'Verification failed',
      detail: err.message,
      code: err.code,
    });
  }
});

// Request password reset
app.post('/request-reset', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    const result = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(200).json({ status: 'ok' });
    }

    const reset = await createPasswordReset(result.rows[0].id);
    const emailResult = await sendResetEmail(email, reset.token);

    const payload = { status: 'ok' };
    if (!SENDGRID_ENABLED) {
      payload.reset_token = reset.token;
      payload.reset_link = emailResult.resetLink;
    }
    res.json(payload);
  } catch (err) {
    console.error('Request reset error:', err);
    res.status(500).json({ error: 'Request reset failed' });
  }
});

// Reset password
app.post('/reset', async (req, res) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password) {
      return res.status(400).json({ error: 'token and new_password are required' });
    }
    if (!isValidPassword(new_password)) {
      return res.status(400).json({
        error:
          'Password must be at least 12 characters and include uppercase, lowercase, number, and symbol',
      });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const result = await pool.query(
      `SELECT id, user_id, expires_at, used_at
       FROM password_resets
       WHERE token_hash = $1`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid token' });
    }

    const row = result.rows[0];
    if (row.used_at) {
      return res.status(400).json({ error: 'Token already used' });
    }
    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Token expired' });
    }

    const hashedPassword = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
      hashedPassword,
      row.user_id,
    ]);
    await pool.query('UPDATE password_resets SET used_at = NOW() WHERE id = $1', [
      row.id,
    ]);
    await pool.query('UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1', [
      row.user_id,
    ]);

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Reset error:', err);
    res.status(500).json({ error: 'Reset failed' });
  }
});

// Reset page (simple HTML form)
app.get('/reset', (req, res) => {
  const token = req.query.token || '';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html>
<html>
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>Reset Password</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 24px; max-width: 520px; margin: 0 auto; }
      input { width: 100%; padding: 10px; margin: 8px 0; }
      button { padding: 10px 16px; }
      .msg { margin-top: 12px; }
    </style>
  </head>
  <body>
    <h2>Reset Password</h2>
    <form id=\"reset-form\">
      <input type=\"hidden\" name=\"token\" value=\"${token}\" />
      <label>New password</label>
      <input type=\"password\" name=\"new_password\" required />
      <button type=\"submit\">Reset</button>
    </form>
    <div id=\"msg\" class=\"msg\"></div>
    <script>
      const form = document.getElementById('reset-form');
      const msg = document.getElementById('msg');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        msg.textContent = 'Submitting...';
        const formData = new FormData(form);
        const payload = Object.fromEntries(formData.entries());
        const res = await fetch('/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
          msg.textContent = 'Password reset successfully. You can now log in.';
        } else {
          msg.textContent = data.error || 'Reset failed.';
        }
      });
    </script>
  </body>
</html>`);
});

// Token refresh
app.post('/refresh', async (req, res) => {
  try {
    if (!requireCsrf(req, res)) return;
    const refresh_token = getRefreshTokenFromRequest(req);
    if (!refresh_token) {
      log('warn', 'refresh_missing_token', { req_id: req.id });
      return res.status(400).json({ error: 'refresh_token is required' });
    }

    let lookupHash = hashRefreshTokenLookup(refresh_token);

    let result = await pool.query(
      `SELECT s.id, s.user_id, s.expires_at, s.revoked_at, s.refresh_token_hash,
              u.email, u.name, u.refresh_token_salt
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.refresh_token_lookup = $1`,
      [lookupHash]
    );

    if (result.rows.length === 0) {
      const legacyHash = hashRefreshTokenLegacy(refresh_token);
      const oldHash = hashRefreshToken(refresh_token);
      result = await pool.query(
        `SELECT s.id, s.user_id, s.expires_at, s.revoked_at, s.refresh_token_hash,
                u.email, u.name, u.refresh_token_salt
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.refresh_token_hash = $1`,
        [legacyHash]
      );
      if (result.rows.length === 0) {
        result = await pool.query(
          `SELECT s.id, s.user_id, s.expires_at, s.revoked_at, s.refresh_token_hash,
                  u.email, u.name, u.refresh_token_salt
           FROM sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.refresh_token_hash = $1`,
          [oldHash]
        );
      }
    }

    if (result.rows.length === 0) {
      log('warn', 'refresh_invalid_token', { req_id: req.id });
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const row = result.rows[0];
    const salt = await getUserRefreshSalt(row.user_id, row.refresh_token_salt);
    const expectedHash = hashRefreshTokenWithSalt(refresh_token, salt);
    const legacyHash = hashRefreshTokenLegacy(refresh_token);
    const oldHash = hashRefreshToken(refresh_token);
    if (row.refresh_token_hash !== expectedHash) {
      if (row.refresh_token_hash === legacyHash || row.refresh_token_hash === oldHash) {
        await pool.query(
          'UPDATE sessions SET refresh_token_hash = $1, refresh_token_lookup = $2 WHERE id = $3',
          [expectedHash, lookupHash, row.id]
        );
      } else {
        log('warn', 'refresh_invalid_token', { req_id: req.id });
        return res.status(401).json({ error: 'Invalid refresh token' });
      }
    }

    if (new Date(row.expires_at) < new Date()) {
      log('warn', 'refresh_expired_token', { req_id: req.id });
      return res.status(401).json({ error: 'Refresh token expired' });
    }
    if (row.revoked_at) {
      // Reuse detected: revoke all active sessions for this user
      await pool.query(
        'UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
        [row.user_id]
      );
      log('warn', 'refresh_reused_token', { req_id: req.id, user_id: row.user_id });
      return res.status(401).json({ error: 'Refresh token reused' });
    }

    const accessToken = signAccessToken({
      id: row.user_id,
      email: row.email,
      name: row.name,
    });

    // Rotate refresh token: revoke old, create new
    const newSession = await createSession(row.user_id, req, salt);
    await pool.query(
      `UPDATE sessions
       SET revoked_at = NOW(), replaced_by = $2
       WHERE id = $1`,
      [row.id, newSession.id]
    );

    setRefreshCookie(res, newSession.refreshToken);
    const payload = {
      access_token: accessToken,
      refresh_expires_at: newSession.expiresAt,
    };
    if (USE_REFRESH_COOKIE) {
      const csrfToken = crypto.randomUUID();
      setCsrfCookie(res, csrfToken);
      payload.csrf_token = csrfToken;
    }
    if (EXPOSE_REFRESH_TOKEN) {
      payload.refresh_token = newSession.refreshToken;
    }
    res.json(payload);
  } catch (err) {
    log('error', 'refresh_error', { req_id: req.id, error: err.message, code: err.code });
    res.status(500).json({ error: 'Refresh failed' });
  }
});

// Logout (revoke refresh token)
app.post('/logout', async (req, res) => {
  try {
    if (!requireCsrf(req, res)) return;
    const refresh_token = getRefreshTokenFromRequest(req);
    if (!refresh_token) {
      log('warn', 'logout_missing_token', { req_id: req.id });
      return res.status(400).json({ error: 'refresh_token is required' });
    }
    let lookupHash = hashRefreshTokenLookup(refresh_token);
    let updateRes = await pool.query(
      'UPDATE sessions SET revoked_at = NOW() WHERE refresh_token_lookup = $1',
      [lookupHash]
    );
    if (updateRes.rowCount === 0) {
      const legacyHash = hashRefreshTokenLegacy(refresh_token);
      const oldHash = hashRefreshToken(refresh_token);
      updateRes = await pool.query(
        'UPDATE sessions SET revoked_at = NOW(), refresh_token_lookup = $1 WHERE refresh_token_hash = $2',
        [lookupHash, legacyHash]
      );
      if (updateRes.rowCount === 0) {
        await pool.query(
          'UPDATE sessions SET revoked_at = NOW(), refresh_token_lookup = $1 WHERE refresh_token_hash = $2',
          [lookupHash, oldHash]
        );
      }
    }
    clearRefreshCookie(res);
    clearCsrfCookie(res);
    res.json({ status: 'ok' });
  } catch (err) {
    log('error', 'logout_error', { req_id: req.id, error: err.message, code: err.code });
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Cleanup expired sessions
app.post('/sessions/cleanup', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM sessions WHERE expires_at < NOW()');
    res.json({ deleted: result.rowCount });
  } catch (err) {
    log('error', 'cleanup_error', { req_id: req.id, error: err.message, code: err.code });
    res.status(500).json({ error: 'Cleanup failed' });
  }
});

// Protected profile
app.get('/me', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, created_at FROM users WHERE id = $1',
      [req.user.sub]
    );
    if (result.rows.length === 0) {
      log('warn', 'me_not_found', { req_id: req.id, user_id: req.user.sub });
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    log('error', 'me_error', { req_id: req.id, error: err.message, code: err.code });
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

if (require.main === module) {
  app.listen(3000, () => {
    log('info', 'server_started', { port: 3000 });
  });

  // Periodic cleanup of expired sessions
  setInterval(async () => {
    try {
      const result = await pool.query('DELETE FROM sessions WHERE expires_at < NOW()');
      if (result.rowCount > 0) {
        log('info', 'sessions_cleanup', { deleted: result.rowCount });
      }
    } catch (err) {
      log('error', 'sessions_cleanup_error', { error: err.message, code: err.code });
    }
  }, CLEANUP_INTERVAL_MS);
}

module.exports = app;
