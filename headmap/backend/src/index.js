'use strict';
const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── helpers ──────────────────────────────────────────────────────────────────
function makeToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
}

function auth(req, res, next) {
  const hdr = req.headers.authorization;
  if (!hdr) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(hdr.split(' ')[1], JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ── auth routes ───────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE username=$1', [username.toLowerCase().trim()]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ token: makeToken(user), user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role } });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, username, display_name, role FROM users WHERE id=$1', [req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const u = rows[0];
    res.json({ id: u.id, username: u.username, displayName: u.display_name, role: u.role });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── user management (admin) ───────────────────────────────────────────────────
app.get('/api/users', auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, username, display_name, role, created_at FROM users ORDER BY created_at');
    res.json(rows.map(u => ({ id: u.id, username: u.username, displayName: u.display_name, role: u.role, createdAt: u.created_at })));
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/users', auth, adminOnly, async (req, res) => {
  const { username, password, displayName, role } = req.body;
  if (!username || !password || !displayName) return res.status(400).json({ error: 'Missing fields' });
  const safeRole = role === 'admin' ? 'admin' : 'user';
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (username, password, display_name, role) VALUES ($1,$2,$3,$4) RETURNING id, username, display_name, role',
      [username.toLowerCase().trim(), hash, displayName.trim(), safeRole]
    );
    const u = rows[0];
    // create empty data row
    await pool.query('INSERT INTO user_data (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [u.id]);
    res.status(201).json({ id: u.id, username: u.username, displayName: u.display_name, role: u.role });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/users/:id', auth, adminOnly, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  try {
    await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.patch('/api/users/:id/password', auth, adminOnly, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 4) return res.status(400).json({ error: 'Password too short' });
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hash, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── app data ──────────────────────────────────────────────────────────────────
app.get('/api/data', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM user_data WHERE user_id=$1', [req.user.id]);
    if (!rows[0]) {
      // create row if missing
      await pool.query('INSERT INTO user_data (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [req.user.id]);
      return res.json({ theme: 'white', roles: [], divisions: [], people: [], sops: [] });
    }
    const d = rows[0];
    res.json({ theme: d.theme, roles: d.roles, divisions: d.divisions, people: d.people, sops: d.sops });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/data', auth, async (req, res) => {
  const { theme, roles, divisions, people, sops } = req.body;
  try {
    await pool.query(
      `INSERT INTO user_data (user_id, theme, roles, divisions, people, sops, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT (user_id) DO UPDATE SET
         theme=$2, roles=$3, divisions=$4, people=$5, sops=$6, updated_at=now()`,
      [req.user.id, theme||'white', JSON.stringify(roles||[]), JSON.stringify(divisions||[]), JSON.stringify(people||[]), JSON.stringify(sops||[])]
    );
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// ── health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`headmap backend on :${PORT}`));