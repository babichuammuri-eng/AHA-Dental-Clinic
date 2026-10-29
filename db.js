// Database connection and table definitions (SQLite, one file: clinic.db)
const Database = require('better-sqlite3');
const path = require('path');

// DATABASE_PATH lets a host keep the database on a persistent disk (for example /var/data/clinic.db on Render).
const dbFile = process.env.DATABASE_PATH || path.join(__dirname, 'clinic.db');
require('fs').mkdirSync(path.dirname(dbFile), { recursive: true });
const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS doctors(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, specialty TEXT NOT NULL, bio TEXT);

-- Every service belongs to one doctor: this is how bookings are auto-assigned.
CREATE TABLE IF NOT EXISTS services(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, price INTEGER NOT NULL,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id));

-- Staff logins: one reception admin and one account per doctor.
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','doctor')), display_name TEXT NOT NULL,
  doctor_id INTEGER REFERENCES doctors(id));

-- Patients are identified by phone number, so history follows them between visits.
CREATE TABLE IF NOT EXISTS patients(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL, email TEXT,
  allergies TEXT DEFAULT '', no_shows INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

-- A booking is one request from a patient (status: pending, confirmed, completed, cancelled, no_show).
-- payment_status: none, waived, unpaid, submitted, paid, rejected, refund_due, refunded, forfeited, expired.
CREATE TABLE IF NOT EXISTS bookings(
  id INTEGER PRIMARY KEY, ref TEXT UNIQUE NOT NULL,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  date TEXT NOT NULL, notes TEXT, status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'online', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  deposit INTEGER NOT NULL DEFAULT 0, payment_status TEXT NOT NULL DEFAULT 'none',
  payment_method TEXT, payment_ref TEXT, paid_at TEXT, expires_at TEXT);

-- A visit is one service with one doctor in one 30-minute slot, plus the medical record.
CREATE TABLE IF NOT EXISTS visits(
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  date TEXT NOT NULL, time TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled',
  diagnosis TEXT, treatment TEXT, medicines TEXT, doctor_notes TEXT, completed_at TEXT);

-- One active visit per doctor, date and time: double booking is impossible.
CREATE UNIQUE INDEX IF NOT EXISTS no_double_booking
  ON visits(doctor_id, date, time) WHERE status != 'cancelled';
CREATE INDEX IF NOT EXISTS visits_by_booking ON visits(booking_id);
CREATE INDEX IF NOT EXISTS bookings_by_patient ON bookings(patient_id);

-- PAYMENT LEDGER: the single source of truth for money. Every payment, refund and adjustment is its own
-- record and is never overwritten or deleted. The payment columns on bookings (payment_method,
-- payment_ref, paid_at) are legacy: old values were copied into this table and are no longer used.
CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  type TEXT NOT NULL CHECK(type IN ('deposit','partial','final','refund','adjustment')),
  amount INTEGER NOT NULL CHECK(amount > 0),
  currency TEXT NOT NULL DEFAULT 'ETB',
  method TEXT, transaction_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected')),
  paid_at TEXT, created_at TEXT NOT NULL,
  verified_by INTEGER REFERENCES users(id), verified_at TEXT,
  rejected_by INTEGER REFERENCES users(id), rejected_at TEXT,
  receipt_seq INTEGER, receipt_no TEXT UNIQUE,
  label TEXT, cumulative_paid INTEGER, balance_after INTEGER, snapshot TEXT,
  related_payment_id INTEGER REFERENCES payments(id),
  reason TEXT, note TEXT, idempotency_key TEXT);
CREATE INDEX IF NOT EXISTS payments_by_booking ON payments(booking_id);
CREATE INDEX IF NOT EXISTS payments_by_patient ON payments(patient_id);
-- The same transaction ID cannot be used for two live payments (stops reusing one real payment).
CREATE UNIQUE INDEX IF NOT EXISTS unique_transaction ON payments(method, transaction_ref)
  WHERE transaction_ref IS NOT NULL AND status IN ('pending','verified') AND type IN ('deposit','partial','final');
-- A form submitted twice (double click, retry) creates only one record.
CREATE UNIQUE INDEX IF NOT EXISTS unique_idempotency ON payments(idempotency_key) WHERE idempotency_key IS NOT NULL;
`);

// Older clinic.db files get the new columns automatically.
function addColumn(table, column, definition) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column))
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('patients', 'no_shows', 'INTEGER DEFAULT 0');
addColumn('bookings', 'deposit', 'INTEGER NOT NULL DEFAULT 0');
addColumn('bookings', 'payment_status', "TEXT NOT NULL DEFAULT 'none'");
addColumn('bookings', 'payment_method', 'TEXT');
addColumn('bookings', 'payment_ref', 'TEXT');
addColumn('bookings', 'paid_at', 'TEXT');
addColumn('bookings', 'expires_at', 'TEXT');

// The old duplicate check moved to the payments ledger (unique_transaction).
db.exec('DROP INDEX IF EXISTS unique_payment');

module.exports = db;
