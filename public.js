// Everything a patient can do without signing in.
const router = require('express').Router();
const db = require('../db');
const config = require('../config');
const { bad } = require('../lib/errors');
const S = require('../lib/scheduling');
const ledger = require('../lib/ledger');
const { listBookings, getBookingById, getBookingByRef } = require('../lib/queries');

// Simple in-memory rate limiter: allows `max` requests per `windowMs` for a key.
const hits = new Map();
function allow(key, max, windowMs) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) return false;
  hits.set(key, [...recent, now]);
  return true;
}

router.get('/doctors', (req, res) => {
  const services = db.prepare('SELECT doctor_id, name FROM services').all();
  res.json(db.prepare('SELECT * FROM doctors').all().map((d) => ({ ...d, services: services.filter((s) => s.doctor_id === d.id).map((s) => s.name) })));
});

router.get('/services', (req, res) => {
  res.json(db.prepare('SELECT s.*, d.name AS doctor FROM services s JOIN doctors d ON d.id = s.doctor_id ORDER BY s.id').all());
});

// Public clinic details (also printed on receipts).
router.get('/clinic', (req, res) => res.json(config.clinic));

// Deposit rules and the clinic's payment accounts, shown to the patient.
router.get('/payment-info', (req, res) => {
  const { percent, min, holdMinutes } = config.deposit;
  res.json({ percent, min, holdMinutes, refundHours: config.refundHoursBefore, methods: config.payment.methods });
});

// Free start times for the chosen services on a date.
router.get('/slots', (req, res) => {
  S.expireUnpaid();
  const date = String(req.query.date || '');
  const items = S.loadServices(S.parseServiceIds(req.query.services));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !items) return res.json({ closed: false, slots: [] });
  if (S.isSunday(date)) return res.json({ closed: true, slots: [] });
  res.json({ closed: false, slots: S.freeStarts(date, items) });
});

router.post('/bookings', (req, res) => {
  if (req.body.website) bad('Invalid request.'); // hidden field: only bots fill it in
  if (!allow('book|' + req.ip, config.limits.bookingsPerIpPerHour, 60 * 60 * 1000)) bad('Too many booking requests from this device. Please call the clinic.', 429);
  res.status(201).json(S.createBooking(req.body, { source: 'online', status: 'pending' }));
});

// ----- Finding a booking: by reference, by phone, or both -----
const NOT_FOUND = 'No booking found. Check the reference number and phone number.';

// Cancelling and paying need the reference number (the phone number is optional if allowed in config.js).
function findByRef(body) {
  S.expireUnpaid();
  const ref = String(body.ref || '').trim().toUpperCase();
  const phone = S.normalizePhone(body.phone);
  if (!ref) bad('Enter your reference number.');
  const booking = getBookingByRef(ref);
  if (!booking || (phone && booking.patient.phone !== phone)) bad(NOT_FOUND, 404);
  if (!phone && !config.lookup.allowReferenceOnly) bad('Enter your phone number too.');
  return booking;
}

// A phone number alone is easy to guess, so it only shows a masked, view-only summary.
function mask(b) {
  return { ...b, ref: 'AHA-••••' + b.ref.slice(-2), notes: '', view_only: true,
    patient: { name: b.patient.name.split(' ')[0], phone: '', email: '', no_shows: 0 },
    payment: { status: b.payment.status, deposit: b.payment.deposit, method: '', ref: '', expires_at: null, paid_at: null }, money: null };
}

router.post('/bookings/lookup', (req, res) => {
  if (!allow('lookup|' + req.ip, 30, 15 * 60 * 1000)) bad('Too many searches. Try again in a few minutes.', 429);
  const phone = S.normalizePhone(req.body.phone);
  if (String(req.body.ref || '').trim()) return res.json({ bookings: [findByRef(req.body)] });
  if (!phone) bad('Enter your reference number or your phone number.');
  if (!config.lookup.allowPhoneOnly) bad('Enter your reference number.');
  S.expireUnpaid();
  const list = listBookings('WHERE p.phone=?', [phone]).slice(0, 5);
  if (!list.length) bad(NOT_FOUND, 404);
  res.json({ bookings: list.map(mask) });
});

// The patient reports the deposit: method and the transaction ID from the bank or Telebirr message.
// It is saved as PENDING in the payment ledger. It counts for nothing until reception verifies it.
router.post('/bookings/payment', (req, res) => {
  const b = findByRef(req.body);
  const method = config.payment.methods.find((m) => m.id === req.body.method);
  if (!method) bad('Choose how you paid.');
  if (b.status !== 'pending' || !['unpaid', 'rejected'].includes(b.payment.status)) bad('This booking is not waiting for a deposit.');
  ledger.submitDeposit(b.id, method.id, req.body.transaction_ref);
  res.json(getBookingById(b.id));
});

router.post('/bookings/cancel', (req, res) => {
  const b = findByRef(req.body);
  if (!['pending', 'confirmed'].includes(b.status) || b.visits.some((v) => v.status === 'completed')) bad('This booking can no longer be cancelled.');
  S.cancelBooking(b.id, 'patient');
  res.json(getBookingById(b.id));
});

module.exports = router;
