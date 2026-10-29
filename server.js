// AHA Dental Clinic: web server entry point.
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
require('./seed'); // creates tables and first-run data
const { requireRole, noStore } = require('./middleware/auth');

const PROD = process.env.NODE_ENV === 'production';
const app = express();
app.disable('x-powered-by');
if (PROD) app.set('trust proxy', 1); // behind an HTTPS proxy (Render, Nginx, ...)

// Security headers on every response.
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'"
  });
  if (PROD) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});

// Requests that change data must come from this website (blocks cross-site request forgery).
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin && new URL(origin).host !== req.get('host'))
    return res.status(403).json({ error: 'Request blocked.' });
  next();
});

app.use(express.json({ limit: '100kb' }));

// The session secret is never written in the code. Without SESSION_SECRET a random one is made at start-up
// (staff must then sign in again after a restart).
if (!process.env.SESSION_SECRET) console.warn('Note: SESSION_SECRET is not set, so a random one is used. Set it in production.');
app.use(session({
  name: 'aha.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false, saveUninitialized: false, // visitors who never sign in get no cookie
  cookie: { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 1000 * 60 * 60 * 8 }
}));

// Old staff addresses now lead to the staff login. The dashboards are no longer public files.
app.get(['/login.html', '/admin.html', '/doctor.html', '/staff-login.html'], (req, res) => res.redirect(302, '/staff-login'));
app.use(require('./routes/staff-pages'));
const FRONTEND = path.join(__dirname, '..', 'frontend'); // all pages, scripts and styles live in the frontend folder
app.use(express.static(path.join(FRONTEND, 'public')));

app.use('/api/auth', noStore, require('./routes/auth'));
app.use('/api/admin', noStore, requireRole('admin'), require('./routes/admin'));
app.use('/api/doctor', noStore, requireRole('doctor'), require('./routes/doctor'));
app.use('/api', require('./routes/public'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

// Every minute, release the slots of bookings whose deposit did not arrive in time.
setInterval(() => require('./lib/scheduling').expireUnpaid(), 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AHA Dental Clinic running at http://localhost:${PORT}\nStaff sign-in page: http://localhost:${PORT}/staff-login`));
