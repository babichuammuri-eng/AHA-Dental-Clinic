// Read queries shared by the public, reception and doctor routes.
const db = require('../db');
const { summaryFrom } = require('./ledger');

const placeholders = (n) => Array(n).fill('?').join(',');

// Returns bookings with their patient, visits and money (calculated from the payment ledger).
function listBookings(where = '', params = []) {
  const rows = db.prepare(`SELECT b.*, p.name AS patient_name, p.phone, p.email, p.no_shows FROM bookings b
    JOIN patients p ON p.id = b.patient_id ${where}
    ORDER BY (b.status = 'pending') DESC, b.date DESC, b.id DESC LIMIT 200`).all(...params);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const visits = db.prepare(`SELECT v.id, v.booking_id, v.time, v.status, s.name AS service, s.price, d.name AS doctor
    FROM visits v JOIN services s ON s.id = v.service_id JOIN doctors d ON d.id = v.doctor_id
    WHERE v.booking_id IN (${placeholders(ids.length)}) ORDER BY v.time`).all(...ids);
  const ledger = db.prepare(`SELECT id, booking_id, type, amount, status, method, transaction_ref, paid_at FROM payments
    WHERE booking_id IN (${placeholders(ids.length)}) ORDER BY id`).all(...ids);
  return rows.map((r) => {
    const mine = visits.filter((v) => v.booking_id === r.id);
    const pays = ledger.filter((y) => y.booking_id === r.id);
    const money = summaryFrom(r, mine, pays);
    // The payment the patient or reception should look at: the waiting one, else the latest accepted one.
    const shown = pays.filter((y) => y.status === 'pending').pop() || pays.filter((y) => y.status === 'verified' && y.type !== 'adjustment').pop() || pays.filter((y) => y.status === 'rejected').pop();
    return {
      id: r.id, ref: r.ref, status: r.status, date: r.date, notes: r.notes || '', source: r.source, created_at: r.created_at,
      patient: { id: r.patient_id, name: r.patient_name, phone: r.phone, email: r.email || '', no_shows: r.no_shows || 0 },
      payment: { status: r.payment_status, deposit: r.deposit, method: shown ? shown.method || '' : '', ref: shown ? shown.transaction_ref || '' : '',
        expires_at: r.expires_at, paid_at: shown ? shown.paid_at : null, payment_id: shown ? shown.id : null },
      money, visits: mine, total: mine.filter((v) => v.status !== 'cancelled').reduce((a, v) => a + v.price, 0)
    };
  });
}
const getBookingById = (id) => listBookings('WHERE b.id=?', [id])[0];
const getBookingByRef = (ref) => listBookings('WHERE b.ref=?', [ref])[0];

// Every completed visit of a patient, newest first: diagnosis, treatment and medicines.
function patientHistory(patientId) {
  const patient = db.prepare('SELECT id, name, phone, email, allergies, created_at FROM patients WHERE id=?').get(patientId);
  if (!patient) return null;
  const history = db.prepare(`SELECT v.id, v.date, v.time, v.diagnosis, v.treatment, v.medicines, v.doctor_notes,
      s.name AS service, d.name AS doctor
    FROM visits v JOIN bookings b ON b.id = v.booking_id JOIN services s ON s.id = v.service_id JOIN doctors d ON d.id = v.doctor_id
    WHERE b.patient_id = ? AND v.status = 'completed' ORDER BY v.date DESC, v.time DESC`).all(patientId);
  return { patient, history };
}

module.exports = { listBookings, getBookingById, getBookingByRef, patientHistory };
