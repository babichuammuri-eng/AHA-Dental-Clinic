// PAYMENT LEDGER. Every payment, refund and adjustment is a separate record that is never overwritten.
// Rules: an entered transaction ID is "pending" and counts for nothing until reception verifies it;
// verified payments can never add up to more than the amount due; refunds and discounts are recorded
// as their own traceable transactions.
const db = require('../db');
const config = require('../config');
const { bad } = require('./errors');

const PAY_TYPES = ['deposit', 'partial', 'final'];
const isoNow = () => new Date().toISOString();
const paymentNo = (id) => 'PAY-' + String(id).padStart(6, '0');
const methodName = (id) => (id === 'cash' ? 'Cash' : (config.payment.methods.find((m) => m.id === id) || {}).name || id || '');
const isClosed = (status) => ['cancelled', 'no_show'].includes(status);

// ---------- Calculations (pure: they only look at the booking, its visits and its ledger rows) ----------
function summaryFrom(b, visits, rows) {
  const closed = isClosed(b.status);
  const total = visits.filter((v) => closed || v.status !== 'cancelled').reduce((a, v) => a + v.price, 0);
  const sum = (f) => rows.filter(f).reduce((a, r) => a + r.amount, 0);
  const paid = sum((r) => r.status === 'verified' && PAY_TYPES.includes(r.type));
  const refunded = sum((r) => r.status === 'verified' && r.type === 'refund');
  const discounts = sum((r) => r.status === 'verified' && r.type === 'adjustment');
  const pending = sum((r) => r.status === 'pending' && PAY_TYPES.includes(r.type));
  const netPaid = paid - refunded;
  // Cancelled and missed bookings owe nothing, except a forfeited deposit which the clinic keeps.
  const due = closed ? (b.payment_status === 'forfeited' ? Math.max(netPaid, 0) : 0) : Math.max(total - discounts, 0);
  const balance = Math.max(due - netPaid, 0);
  const refundOwed = closed && b.payment_status === 'refund_due' ? Math.max(netPaid, 0) : 0;
  let settlement;
  if (closed) settlement = b.payment_status === 'forfeited' ? 'Deposit kept' : refundOwed ? 'Refund due' : refunded ? 'Refunded' : 'Cancelled';
  else if (netPaid <= 0) settlement = pending ? 'Awaiting verification' : 'Unpaid';
  else settlement = balance === 0 ? 'Paid in full' : 'Partially paid';
  return { total, discounts, due, deposit: b.deposit, paid, refunded, netPaid, pending, balance, refundOwed, settlement, currency: config.ledger.currency };
}

function summary(bookingId) {
  const b = db.prepare('SELECT status, payment_status, deposit FROM bookings WHERE id=?').get(bookingId);
  if (!b) return null;
  const visits = db.prepare('SELECT v.status, s.price FROM visits v JOIN services s ON s.id = v.service_id WHERE v.booking_id=?').all(bookingId);
  const rows = db.prepare('SELECT type, amount, status FROM payments WHERE booking_id=?').all(bookingId);
  return summaryFrom(b, visits, rows);
}

// ---------- Internal helpers ----------
function insertRow(r) {
  try {
    return db.prepare(`INSERT INTO payments(booking_id, patient_id, type, amount, currency, method, transaction_ref, status, paid_at, created_at,
      related_payment_id, reason, note, idempotency_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(r.bookingId, r.patientId, r.type, r.amount,
      config.ledger.currency, r.method || null, r.ref || null, r.status, r.paidAt || null, r.createdAt, r.relatedId || null,
      r.reason || null, r.note || null, r.key || null).lastInsertRowid;
  } catch (e) {
    const m = String(e.message);
    if (m.includes('idempotency_key')) bad('This entry was already saved (duplicate submission).', 409);
    if (m.includes('transaction_ref')) bad('This transaction ID was already used for another payment. Check it, or call the clinic.');
    throw e;
  }
}

function cleanAmount(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > 10000000) bad('Enter the amount as a whole number of ETB.');
  return n;
}
function cleanRef(method, ref, required) {
  const r = String(ref || '').trim().toUpperCase();
  if (method === 'cash') return null;
  if (!r && !required) return null;
  if (!/^[A-Z0-9-]{6,30}$/.test(r)) bad('Enter the transaction ID (6 to 30 letters and numbers).');
  return r;
}
const cleanText = (t, n) => String(t || '').trim().slice(0, n);
const cleanKey = (k) => (k ? String(k).slice(0, 64) : null);

function snapshot(bookingId) {
  const b = db.prepare('SELECT status FROM bookings WHERE id=?').get(bookingId);
  const closed = isClosed(b.status);
  const items = db.prepare(`SELECT s.name, s.price, v.status FROM visits v JOIN services s ON s.id = v.service_id WHERE v.booking_id=? ORDER BY v.time`)
    .all(bookingId).filter((v) => closed || v.status !== 'cancelled').map((v) => ({ name: v.name, price: v.price }));
  const s = summary(bookingId);
  return { items, total: s.total, discounts: s.discounts, due: s.due };
}

// Marks a record verified and freezes the receipt: number, label, running totals and the itemized services.
// Receipts never change afterwards, even if prices or visits change later.
function finalizeRow(id, user, at, force = false) {
  const y = db.prepare('SELECT * FROM payments WHERE id=?').get(id);
  const bk = db.prepare('SELECT status FROM bookings WHERE id=?').get(y.booking_id);
  if (!force && PAY_TYPES.includes(y.type)) {
    if (isClosed(bk.status)) bad('This booking is cancelled, so a new payment cannot be verified. Record a refund if money was received.');
    const before = summary(y.booking_id);
    if (y.amount > before.balance) bad(`This payment (${y.amount} ETB) is more than the remaining balance (${before.balance} ETB).`);
  }
  db.prepare("UPDATE payments SET status='verified', verified_by=?, verified_at=? WHERE id=?").run(user ? user.id : null, at, id);
  const after = summary(y.booking_id);
  let label;
  if (y.type === 'adjustment') label = 'Adjustment';
  else if (y.type === 'refund') label = 'Refund';
  else if (!isClosed(bk.status) && after.due > 0 && after.netPaid >= after.due) label = 'Paid in Full';
  else label = y.type === 'deposit' ? 'Deposit' : 'Partial Payment';
  let seq = null, no = null;
  if (y.type !== 'adjustment') {
    seq = db.prepare('SELECT COALESCE(MAX(receipt_seq), 0) + 1 AS n FROM payments').get().n;
    no = `AHA-R-${at.slice(0, 4)}-${String(seq).padStart(5, '0')}`;
  }
  db.prepare('UPDATE payments SET label=?, cumulative_paid=?, balance_after=?, snapshot=?, receipt_seq=?, receipt_no=? WHERE id=?')
    .run(label, after.netPaid, after.balance, JSON.stringify(snapshot(y.booking_id)), seq, no, id);
}

// ---------- Operations ----------
// Patient reports a deposit payment online. It stays PENDING: it is not money received until reception verifies it.
function submitDeposit(bookingId, method, ref) {
  const b = db.prepare('SELECT patient_id, deposit FROM bookings WHERE id=?').get(bookingId);
  if (db.prepare("SELECT 1 FROM payments WHERE booking_id=? AND status='pending' AND type IN ('deposit','partial','final')").get(bookingId))
    bad('A payment for this booking is already waiting for verification.');
  const at = isoNow();
  return db.transaction(() => {
    const id = insertRow({ bookingId, patientId: b.patient_id, type: 'deposit', amount: b.deposit, method, ref: cleanRef(method, ref, true),
      status: 'pending', paidAt: at, createdAt: at });
    db.prepare("UPDATE bookings SET payment_status='submitted' WHERE id=?").run(bookingId);
    return id;
  })();
}

function verifyPayment(paymentId, user) {
  const y = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
  if (!y) bad('Payment not found.', 404);
  if (y.status !== 'pending') bad('This payment is not waiting for verification.');
  db.transaction(() => {
    finalizeRow(paymentId, user, isoNow());
    // The first verified money confirms a pending booking and sends it to the doctors.
    db.prepare("UPDATE bookings SET payment_status='paid', status = CASE WHEN status='pending' THEN 'confirmed' ELSE status END WHERE id=?").run(y.booking_id);
  })();
}

function rejectPayment(paymentId, user, reason) {
  const y = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
  if (!y) bad('Payment not found.', 404);
  if (y.status !== 'pending') bad('This payment is not waiting for verification.');
  db.transaction(() => {
    db.prepare("UPDATE payments SET status='rejected', rejected_by=?, rejected_at=?, note=? WHERE id=?")
      .run(user.id, isoNow(), cleanText(reason, 200) || 'Transaction not found in the clinic account', paymentId);
    if (summary(y.booking_id).netPaid <= 0) // the patient gets more time to submit the correct transaction ID
      db.prepare("UPDATE bookings SET payment_status='rejected', expires_at=? WHERE id=?")
        .run(new Date(Date.now() + config.deposit.holdMinutes * 60000).toISOString(), y.booking_id);
  })();
}

// Reception records money received at the counter or by transfer. The staff member who enters it is the verifier.
function recordPayment({ bookingId, type, amount, method, ref, key, note, user, at }) {
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(bookingId);
  if (!b) bad('Booking not found.', 404);
  if (isClosed(b.status)) bad('This booking is cancelled. Record a refund instead of a payment.');
  if (!PAY_TYPES.includes(type)) bad('Choose the payment type.');
  if (!config.ledger.counterMethods.includes(method)) bad('Choose the payment method.');
  amount = cleanAmount(amount);
  const s = summary(bookingId);
  if (s.balance === 0) bad('This booking is already paid in full.');
  if (amount > s.balance) bad(`The amount is more than the remaining balance (${s.balance} ETB).`);
  if (type === 'final' && amount !== s.balance) bad(`A final payment must equal the remaining balance (${s.balance} ETB).`);
  if (type === 'partial' && amount === s.balance) bad('This amount settles the account. Choose Final payment.');
  const when = at || isoNow();
  return db.transaction(() => {
    const id = insertRow({ bookingId, patientId: b.patient_id, type, amount, method, ref: cleanRef(method, ref, true), status: 'pending',
      paidAt: when, createdAt: when, note: cleanText(note, 200), key: cleanKey(key) });
    finalizeRow(id, user, when);
    db.prepare("UPDATE bookings SET payment_status='paid', status = CASE WHEN status='pending' THEN 'confirmed' ELSE status END WHERE id=?").run(bookingId);
    return id;
  })();
}

// A refund is a new record linked to the original payment. The original is never changed.
function refund({ paymentId, amount, method, ref, reason, key, user }) {
  const y = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
  if (!y || y.status !== 'verified' || !PAY_TYPES.includes(y.type)) bad('Only a verified payment can be refunded.', 404);
  amount = cleanAmount(amount);
  if (!config.ledger.counterMethods.includes(method)) bad('Choose how the money was returned.');
  if (cleanText(reason, 200).length < 3) bad('Write the reason for the refund.');
  const already = db.prepare("SELECT COALESCE(SUM(amount),0) n FROM payments WHERE related_payment_id=? AND type='refund' AND status='verified'").get(y.id).n;
  if (amount > y.amount - already) bad(`At most ${y.amount - already} ETB of this payment can still be refunded.`);
  if (amount > summary(y.booking_id).netPaid) bad('The refund is more than the net amount paid.');
  const at = isoNow();
  return db.transaction(() => {
    const id = insertRow({ bookingId: y.booking_id, patientId: y.patient_id, type: 'refund', amount, method, ref: cleanRef(method, ref, false),
      status: 'pending', paidAt: at, createdAt: at, relatedId: y.id, reason: cleanText(reason, 200), key: cleanKey(key) });
    finalizeRow(id, user, at);
    const after = summary(y.booking_id);
    const bk = db.prepare('SELECT status, payment_status FROM bookings WHERE id=?').get(y.booking_id);
    if (isClosed(bk.status) && bk.payment_status === 'refund_due' && after.netPaid <= 0)
      db.prepare("UPDATE bookings SET payment_status='refunded' WHERE id=?").run(y.booking_id);
    return id;
  })();
}

// An authorized discount lowers the amount due. It can never push the amount due below what is already paid.
function adjust({ bookingId, amount, reason, key, user }) {
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(bookingId);
  if (!b) bad('Booking not found.', 404);
  if (isClosed(b.status)) bad('A cancelled booking cannot be adjusted.');
  amount = cleanAmount(amount);
  if (cleanText(reason, 200).length < 3) bad('Write the reason for the adjustment.');
  const s = summary(bookingId);
  if (amount > s.balance) bad(`The discount cannot be more than the remaining balance (${s.balance} ETB).`);
  const at = isoNow();
  return db.transaction(() => {
    const id = insertRow({ bookingId, patientId: b.patient_id, type: 'adjustment', amount, method: null, status: 'pending', paidAt: at, createdAt: at,
      reason: cleanText(reason, 200), key: cleanKey(key) });
    finalizeRow(id, user, at);
    return id;
  })();
}

// ---------- Reading ----------
function ledgerFor(bookingId) {
  const rows = db.prepare(`SELECT y.*, v.display_name AS verifier, r.display_name AS rejector FROM payments y
    LEFT JOIN users v ON v.id = y.verified_by LEFT JOIN users r ON r.id = y.rejected_by WHERE y.booking_id=? ORDER BY y.id`).all(bookingId);
  const refunded = {};
  rows.filter((r) => r.type === 'refund' && r.status === 'verified').forEach((r) => { refunded[r.related_payment_id] = (refunded[r.related_payment_id] || 0) + r.amount; });
  return rows.map((r) => ({
    id: r.id, payment_no: paymentNo(r.id), receipt_no: r.receipt_no || '', type: r.type, label: r.label || '', amount: r.amount, currency: r.currency,
    method: r.method || '', method_name: methodName(r.method), transaction_ref: r.transaction_ref || '', status: r.status,
    paid_at: r.paid_at, verified_at: r.verified_at, verified_by: r.status === 'verified' ? (r.verifier || 'Migrated record (verifier not recorded)') : '',
    rejected_by: r.rejector || '', rejected_at: r.rejected_at, reason: r.reason || '', note: r.note || '', related_payment_id: r.related_payment_id,
    cumulative_paid: r.cumulative_paid, balance_after: r.balance_after, has_receipt: r.status === 'verified' && r.type !== 'adjustment',
    refunded: refunded[r.id] || 0, refundable: PAY_TYPES.includes(r.type) && r.status === 'verified' ? r.amount - (refunded[r.id] || 0) : 0
  }));
}

function bookingLedger(bookingId) {
  const booking = db.prepare('SELECT b.id, b.ref, b.date, b.status, b.payment_status, b.deposit FROM bookings b WHERE b.id=?').get(bookingId);
  if (!booking) return null;
  const patient = db.prepare('SELECT p.id, p.name, p.phone FROM patients p JOIN bookings b ON b.patient_id = p.id WHERE b.id=?').get(bookingId);
  return { booking, patient, money: summary(bookingId), payments: ledgerFor(bookingId) };
}

function patientLedger(patientId) {
  const patient = db.prepare('SELECT id, name, phone FROM patients WHERE id=?').get(patientId);
  if (!patient) return null;
  const bookings = db.prepare('SELECT id, ref, date, status FROM bookings WHERE patient_id=? ORDER BY date DESC, id DESC').all(patientId)
    .map((b) => ({ ...b, money: summary(b.id) }));
  const payments = bookings.flatMap((b) => ledgerFor(b.id).map((p) => ({ ...p, booking_ref: b.ref }))).sort((a, b) => b.id - a.id);
  return { patient, bookings, payments };
}

// Search by patient name, phone, booking reference, receipt number or transaction ID.
function searchBookings(q) {
  const like = `%${String(q || '').trim()}%`;
  const ids = db.prepare(`SELECT DISTINCT b.id, b.date FROM bookings b JOIN patients p ON p.id = b.patient_id LEFT JOIN payments y ON y.booking_id = b.id
    WHERE ? = '%%' OR p.name LIKE ? OR p.phone LIKE ? OR b.ref LIKE ? OR y.receipt_no LIKE ? OR y.transaction_ref LIKE ?
    ORDER BY b.date DESC, b.id DESC LIMIT 100`).all(like, like, like, like, like, like);
  return ids.map(({ id }) => {
    const l = bookingLedger(id);
    return { id, ref: l.booking.ref, date: l.booking.date, status: l.booking.status, patient: l.patient, money: l.money, receipts: l.payments.filter((p) => p.receipt_no).length };
  });
}

// Copies money recorded by older versions (columns on bookings) into the ledger, once and safely.
function migrateLegacy() {
  const old = db.prepare(`SELECT * FROM bookings b WHERE b.payment_status IN ('submitted','paid','rejected','refund_due','refunded','forfeited')
    AND b.payment_ref IS NOT NULL AND b.deposit > 0 AND NOT EXISTS (SELECT 1 FROM payments y WHERE y.booking_id = b.id)`).all();
  old.forEach((b) => db.transaction(() => {
    const at = b.paid_at || b.created_at.replace(' ', 'T') + 'Z';
    const base = { bookingId: b.id, patientId: b.patient_id, type: 'deposit', amount: b.deposit, method: b.payment_method, ref: b.payment_ref,
      paidAt: at, createdAt: at, note: 'Migrated from an earlier version' };
    if (b.payment_status === 'submitted') return insertRow({ ...base, status: 'pending' });
    if (b.payment_status === 'rejected') return insertRow({ ...base, status: 'rejected' });
    const id = insertRow({ ...base, status: 'pending' });
    finalizeRow(id, null, at, true);
    if (b.payment_status === 'refunded') {
      const rid = insertRow({ bookingId: b.id, patientId: b.patient_id, type: 'refund', amount: b.deposit, method: 'cash', status: 'pending', paidAt: at, createdAt: at,
        relatedId: id, reason: 'Marked as refunded in an earlier version' });
      finalizeRow(rid, null, at, true);
    }
  })());
  return old.length;
}

module.exports = { PAY_TYPES, methodName, paymentNo, summaryFrom, summary, submitDeposit, verifyPayment, rejectPayment, recordPayment, refund, adjust,
  ledgerFor, bookingLedger, patientLedger, searchBookings, migrateLegacy };
