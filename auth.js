// Sign in, sign out and "who am I" for reception and doctors.
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { homeFor } = require('../middleware/auth');

// Brute-force protection: 8 wrong passwords per user and device, or 30 per device, in 15 minutes.
const failures = new Map();
const recent = (key) => (failures.get(key) || []).filter((t) => Date.now() - t < 15 * 60 * 1000);
const fail = (...keys) => keys.forEach((k) => failures.set(k, [...recent(k), Date.now()]));
// Checked even when the username does not exist, so response time does not reveal which usernames are real.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

router.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase().slice(0, 60);
  const userKey = `${req.ip}|${username}`, ipKey = `${req.ip}|any`;
  if (recent(userKey).length >= 8 || recent(ipKey).length >= 30) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });

  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  const ok = bcrypt.compareSync(String(req.body.password || '').slice(0, 200), user ? user.password_hash : DUMMY_HASH) && user;
  if (!ok) { fail(userKey, ipKey); return res.status(401).json({ error: 'Wrong username or password.' }); }

  failures.delete(userKey);
  // A fresh session id on every login (prevents session fixation).
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Something went wrong.' });
    req.session.user = { id: user.id, role: user.role, doctorId: user.doctor_id, name: user.display_name };
    res.json({ role: user.role, name: user.display_name, next: homeFor(req.session.user) });
  });
});

router.post('/logout', (req, res) => req.session.destroy(() => { res.clearCookie('aha.sid'); res.json({ ok: true }); }));
router.get('/me', (req, res) => res.json({ user: req.session.user ? { role: req.session.user.role, name: req.session.user.name } : null }));

module.exports = router;
