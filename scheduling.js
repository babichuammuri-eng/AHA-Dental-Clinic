// Time slots, auto-assignment of doctors, and booking creation.
const db = require('../db');
const { bad } = require('./errors');
const config = require('../config');

const pad = (n) => String(n).padStart(2, '0');

// Working hours: 30-minute slots from 09:00 to 16:30, lunch break 12:00 to 14:00.
const SLOTS = [];
for (let h = 9; h < 17; h++) {
  if (h === 12 || h === 13) continue;
  SLOTS.push(`${pad(h)}:00`, `${pad(h)}:30`);
}

const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => fmt(new Date());
const offsetDate = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return fmt(d); };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const isSunday = (date) => new Date(date + 'T00:00:00Z').getUTCDay() === 0;
const normalizePhone = (p) => String(p || '').replace(/[\s-]/g, '');

// Accepts [1,2] or "1,2" and returns unique integers.
function parseServiceIds(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  return [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 8);
}

// Loads the services and sorts them by doctor, so one doctor's services sit back to back.
function loadServices(ids) {
  if (!ids.length) return null;
  const rows = db.prepare(`SELECT s.*, d.name AS doctor_name FROM services s JOIN doctors d ON d.id = s.doctor_id
    WHERE s.id IN (${ids.map(() => '?').join(',')}) ORDER BY s.doctor_id, s.id`).all(...ids);
  return rows.length === ids.length ? rows : null;
}

// Start times where every chosen service fits in consecutive slots with its doctor free.
function freeStarts(date, items) {
  if (isSunday(date)) return [];
  const taken = new Set(db.prepare("SELECT doctor_id, time FROM visits WHERE date=? AND status!='cancelled'")
    .all(date).map((r) => `${r.doctor_id}@${r.time}`));
  const starts = [];
  for (let i = 0; i + items.length <= SLOTS.length; i++) {
    let ok = !(date === today() && toMin(SLOTS[i]) <= nowMin());
    for (let k = 0; k < items.length && ok; k++) {
      const t = SLOTS[i + k];
      if (k > 0 && toMin(t) - toMin(SLOTS[i + k - 1]) !== 30) ok = false; // do not jump over lunch
      else if (taken.has(`${items[k].doctor_id}@${t}`)) ok = false;
    }
    if (ok) starts.push(SLOTS[i]);
  }
  return starts;
}

function makeRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let ref = 'AHA-';
    for (let i = 0; i < 6; i++) ref += chars[Math.floor(Math.random() * chars.length)];
    if (!db.prepare('SELECT 1 FROM bookings WHERE ref=?').get(ref)) return ref;
  }
}

// Validates the request, auto-assigns doctors by service, and saves everything in one transaction.
function createBooking(b, { source, status }) {
  const { getBookingById } = require('./queries');
  const online = source === 'online';
  expireUnpaid();
  const name = String(b.patient_name || '').trim();
  const phone = normalizePhone(b.phone);
  const email = String(b.email || '').trim();
  if (name.length < 2) bad('Enter the patient name.');
  if (!/^\+?\d{7,15}$/.test(phone)) bad('Enter a valid phone number.');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) bad('Enter a valid email or leave it empty.');
  const items = loadServices(parseServiceIds(b.service_ids));
  if (!items) bad('Choose at least one service.');
  const date = String(b.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date))) bad('Choose a date.');
  if (date < today()) bad('Choose a date from today onward.');
  if (isSunday(date)) bad('The clinic is closed on Sundays.');
  if (online) {
    const open = db.prepare(`SELECT COUNT(*) n FROM bookings b JOIN patients p ON p.id = b.patient_id
      WHERE p.phone=? AND b.status='pending' AND b.payment_status IN ('unpaid','rejected')`).get(phone).n;
    if (open >= config.limits.maxUnpaidPerPhone) bad('You already have bookings waiting for a deposit. Pay or cancel them first, or call the clinic.');
  }
  if (!freeStarts(date, items).includes(b.time)) bad('That time is no longer available. Pick another slot.');

  const start = SLOTS.indexOf(b.time);
  try {
    const id = db.transaction(() => {
      let patient = db.prepare('SELECT id FROM patients WHERE phone=?').get(phone);
      if (patient) db.prepare("UPDATE patients SET name=?, email=COALESCE(NULLIF(?, ''), email) WHERE id=?").run(name, email, patient.id);
      else patient = { id: db.prepare('INSERT INTO patients(name, phone, email) VALUES(?,?,?)').run(name, phone, email).lastInsertRowid };
      // Online bookings must pay a deposit to hold the slots; reception bookings are waived.
      const total = items.reduce((sum, it) => sum + it.price, 0);
      const noShows = db.prepare('SELECT no_shows FROM patients WHERE id=?').get(patient.id).no_shows || 0;
      const deposit = online ? depositFor(total, noShows) : 0;
      const expires = online ? new Date(Date.now() + config.deposit.holdMinutes * 60000).toISOString() : null;
      const bookingId = db.prepare(`INSERT INTO bookings(ref, patient_id, date, notes, status, source, deposit, payment_status, expires_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(makeRef(), patient.id, date, String(b.notes || '').trim().slice(0, 500), status, source,
        deposit, online ? 'unpaid' : 'waived', expires).lastInsertRowid;
      const addVisit = db.prepare('INSERT INTO visits(booking_id, doctor_id, service_id, date, time) VALUES(?,?,?,?,?)');
      items.forEach((it, k) => addVisit.run(bookingId, it.doctor_id, it.id, date, SLOTS[start + k]));
      return bookingId;
    })();
    return getBookingById(id);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) bad('That time was just taken. Pick another slot.');
    throw e;
  }
}

// Deposit: 10% of the total (minimum 100 ETB), or 50% for patients with repeated no-shows.
function depositFor(total, noShows) {
  const d = config.deposit;
  const percent = noShows >= d.noShowThreshold ? d.repeatNoShowPercent : d.percent;
  return Math.min(total, Math.max(d.min, Math.ceil((total * percent) / 100)));
}

// Cancels a booking and frees its slots. A verified deposit becomes refund_due, unless the patient cancels
// less than 24 hours before the visit (then the clinic keeps it). Payments still waiting for verification
// are closed with a note; the record stays in the ledger.
function cancelBooking(id, by = 'reception') {
  const b = db.prepare(`SELECT date, payment_status, (SELECT MIN(time) FROM visits WHERE booking_id = bookings.id) AS first_time
    FROM bookings WHERE id=?`).get(id);
  let pay = b.payment_status;
  if (pay === 'paid') {
    const hours = (new Date(`${b.date}T${b.first_time || '09:00'}:00`) - Date.now()) / 3600000;
    pay = by === 'patient' && hours < config.refundHoursBefore ? 'forfeited' : 'refund_due';
  } else if (['unpaid', 'submitted', 'rejected'].includes(pay)) pay = 'none';
  db.transaction(() => {
    db.prepare("UPDATE bookings SET status='cancelled', payment_status=? WHERE id=?").run(pay, id);
    db.prepare("UPDATE visits SET status='cancelled' WHERE booking_id=? AND status='scheduled'").run(id);
    db.prepare("UPDATE payments SET status='rejected', note='Booking cancelled before verification. Refund manually if money was received.' WHERE booking_id=? AND status='pending'").run(id);
  })();
}

// The patient did not come: the deposit is kept and the patient's no-show count goes up.
function markNoShow(id) {
  db.transaction(() => {
    const b = db.prepare('SELECT patient_id, payment_status FROM bookings WHERE id=?').get(id);
    db.prepare("UPDATE bookings SET status='no_show', payment_status=? WHERE id=?").run(b.payment_status === 'paid' ? 'forfeited' : b.payment_status, id);
    db.prepare("UPDATE visits SET status='cancelled' WHERE booking_id=? AND status='scheduled'").run(id);
    db.prepare('UPDATE patients SET no_shows = COALESCE(no_shows, 0) + 1 WHERE id=?').run(b.patient_id);
  })();
}

// Releases the slots of bookings whose deposit did not arrive in time.
function expireUnpaid() {
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`UPDATE visits SET status='cancelled' WHERE status='scheduled' AND booking_id IN
      (SELECT id FROM bookings WHERE status='pending' AND payment_status IN ('unpaid','rejected') AND expires_at < ?)`).run(now);
    db.prepare(`UPDATE bookings SET status='cancelled', payment_status='expired'
      WHERE status='pending' AND payment_status IN ('unpaid','rejected') AND expires_at < ?`).run(now);
  })();
}

module.exports = { SLOTS, today, offsetDate, isSunday, normalizePhone, parseServiceIds, loadServices, freeStarts, makeRef,
  createBooking, cancelBooking, markNoShow, expireUnpaid, depositFor };
