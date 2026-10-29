// Staff pages. They live in the private/ folder, which is NOT served publicly, so the only way to
// load a dashboard (or its scripts) is through these routes, after the server checks the session.
const router = require('express').Router();
const path = require('path');
const { requirePage, noStore, homeFor } = require('../middleware/auth');
const { receiptData, renderReceiptHTML } = require('../lib/receipt');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend');
const PRIVATE = path.join(FRONTEND, 'private'); // staff pages: served only after the server checks the session
const send = (file) => (req, res) => res.sendFile(path.join(PRIVATE, file));

router.get('/staff-login', noStore, (req, res) => res.sendFile(path.join(FRONTEND, 'public', 'staff-login.html')));
router.get('/staff', noStore, (req, res) => res.redirect(req.session.user ? homeFor(req.session.user) : '/staff-login'));
router.get('/staff/reception', noStore, requirePage('admin'), send('reception.html'));
router.get('/staff/doctor', noStore, requirePage('doctor'), send('doctor.html'));

// Printable receipt (reception only).
router.get('/staff/receipts/:id', noStore, requirePage('admin'), (req, res) => {
  const data = receiptData(req.params.id);
  if (!data) return res.status(404).type('text').send('Receipt not found.');
  res.type('html').send(renderReceiptHTML(data));
});

// Dashboard scripts and styles: each one only for the role that needs it.
const ASSETS = { 'admin.js': ['js', 'admin'], 'doctor.js': ['js', 'doctor'], 'staff.css': ['css', null] };
router.get('/staff/assets/:file', noStore, (req, res) => {
  const asset = ASSETS[req.params.file];
  if (!asset) return res.status(404).end();
  const user = req.session.user;
  if (!user) return res.status(401).end();
  if (asset[1] && user.role !== asset[1]) return res.status(403).end();
  res.sendFile(path.join(PRIVATE, asset[0], req.params.file));
});

module.exports = router;
