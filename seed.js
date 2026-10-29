// First-run setup: doctors, services, staff accounts.
//   npm start        real setup: random passwords, shown once, no demo patients
//   npm run demo     DEMO mode: known passwords and sample patients (never allowed in production)
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const config = require('./config');
const L = require('./lib/ledger');
const { SLOTS, offsetDate, isSunday, makeRef, depositFor } = require('./lib/scheduling');

const DEMO = process.argv.includes('--demo');
// Hosting: RECEPTION_PASSWORD and DOCTOR_PASSWORD set the first passwords (kept in the host's private settings, never in code).
// SAMPLE_DATA=1 adds sample patients and receipts WITHOUT any known passwords.
const SAMPLE = DEMO || process.env.SAMPLE_DATA === '1';
// Per doctor: DOCTOR_PASSWORD_AMMAR, DOCTOR_PASSWORD_AMANUEL, DOCTOR_PASSWORD_HIWOT, DOCTOR_PASSWORD_SEADA, DOCTOR_PASSWORD_FAITHA.
// DOCTOR_PASSWORD is used for any doctor without their own. Every password must be at least 10 characters.
for (const [name, value] of Object.entries(process.env)) {
  if (/^(RECEPTION_PASSWORD|DOCTOR_PASSWORD(_[A-Z]+)?)$/.test(name) && value && value.length < 10) { console.error(`${name} must be at least 10 characters.`); process.exit(1); }
}
if (DEMO && process.env.NODE_ENV === 'production') { console.error('Demo mode is not allowed in production.'); process.exit(1); }

// Passwords for real use are random, 12 characters, without look-alike letters.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randomPassword = () => Array.from({ length: 12 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');

function seedClinic() {
  const doctors = [
    ['Dr. Ammar Daniel-Maine', 'General & cosmetic dentistry', 'Owner and founder of AHA Dental Clinic. Check-ups, cleaning and smile makeovers.', 'ammar'],
    ['Dr. Amanuel Lemma', 'Orthodontics', 'Braces and clear aligners for teenagers and adults.', 'amanuel'],
    ['Dr. Hiwot Teklu', 'Pediatric dentistry', 'Gentle dental care for children from their first tooth.', 'hiwot'],
    ['Dr. Seada Kassa', 'Restorative & endodontics', 'Fillings, crowns and root canal treatment.', 'seada'],
    ['Dr. Faitha A/Kadir', 'Oral surgery & implants', 'Extractions, wisdom teeth and dental implants.', 'faitha']
  ];
  const accounts = [];
  const addUser = db.prepare('INSERT INTO users(username, password_hash, role, display_name, doctor_id) VALUES(?,?,?,?,?)');
  const makeAccount = (username, role, name, doctorId, demoPassword) => {
    const fromEnv = !DEMO && (role === 'admin' ? process.env.RECEPTION_PASSWORD : process.env[`DOCTOR_PASSWORD_${username.toUpperCase()}`] || process.env.DOCTOR_PASSWORD);
    const password = DEMO ? demoPassword : fromEnv || randomPassword();
    addUser.run(username, bcrypt.hashSync(password, 10), role, name, doctorId);
    // Passwords that came from the environment are never printed.
    accounts.push({ role: role === 'admin' ? 'Reception' : 'Doctor', name, username, password: fromEnv ? '(set in the server settings)' : password });
  };
  makeAccount('reception', 'admin', 'Reception', null, 'reception123');
  const addDoctor = db.prepare('INSERT INTO doctors(name, specialty, bio) VALUES(?,?,?)');
  doctors.forEach(([name, specialty, bio, username]) => makeAccount(username, 'doctor', name, addDoctor.run(name, specialty, bio).lastInsertRowid, 'doctor123'));

  // [name, description, price in ETB, doctor id]
  const services = [
    ['Check-up & cleaning', 'Full exam, scale and polish.', 800, 1], ['Teeth whitening', 'In-chair whitening in about an hour.', 3500, 1],
    ['Braces consultation', 'Assessment and treatment plan.', 1000, 2], ["Children's check-up", 'Gentle exam and fluoride care for kids.', 600, 3],
    ['Filling', 'Tooth-coloured fillings for cavities.', 1500, 4], ['Root canal', 'Treatment to save an infected tooth.', 4500, 4],
    ['Tooth extraction', 'Simple and surgical removal.', 1200, 5], ['Dental implant consultation', 'X-ray, bone check and a plan.', 1500, 5]
  ];
  const addService = db.prepare('INSERT INTO services(name, description, price, doctor_id) VALUES(?,?,?,?)');
  services.forEach((s) => addService.run(...s));
  announce(accounts);
}

// Real setup: show the passwords once, on screen and in a private file. Nothing is stored in plain text elsewhere.
function announce(accounts) {
  const port = process.env.PORT || 3000;
  const url = `http://localhost:${port}/staff-login`;
  const lines = accounts.map((a) => `${a.role.padEnd(10)} ${a.name.padEnd(26)} username: ${a.username.padEnd(10)} password: ${a.password}`);
  console.log(`\n${DEMO ? 'DEMO MODE: known passwords, for demonstrations only.' : 'STAFF ACCOUNTS CREATED (shown only once).'}\nStaff sign-in page: ${url}\n\n${lines.join('\n')}\n`);
  if (!DEMO && process.env.NODE_ENV !== 'production') {
    const file = path.join(__dirname, 'setup-credentials.txt');
    fs.writeFileSync(file, `${config.clinic.name}: staff accounts\nStaff sign-in page: ${url} (use the clinic's real web address in production)\n\n${lines.join('\n')}\n\nGive each person only their own line, then DELETE this file.\n`, { mode: 0o600 });
    console.log('The same list was saved in setup-credentials.txt. Give each person their own line, then delete the file.\n');
  }
}

function seedDemo() {
  const admin = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
  const patients = [['Abebe Kebede', '0911000001'], ['Tigist Worku', '0911000002'], ['Samuel Girma', '0911000003'],
    ['Marta Desta', '0911000004'], ['Bereket Alemu', '0911000005'], ['Liya Tesfaye', '0911000006']];
  const ids = patients.map(([n, p]) => db.prepare('INSERT INTO patients(name, phone, email) VALUES(?,?,?)').run(n, p, '').lastInsertRowid);
  db.prepare("UPDATE patients SET allergies='Penicillin' WHERE id=?").run(ids[2]);
  const svc = db.prepare('SELECT * FROM services').all();
  const diagnosis = ['Mild plaque build-up', 'Surface staining', 'Crowding of lower front teeth', 'Early cavity on a baby molar',
    'Cavity on lower right molar', 'Infected pulp, upper left molar', 'Fractured wisdom tooth', 'Missing molar, bone check needed'];
  const treatment = ['Scale and polish', 'In-chair whitening session', 'Assessment and treatment plan', 'Fluoride varnish applied',
    'Tooth-coloured filling placed', 'Root canal cleaned and sealed', 'Tooth removed under local anaesthetic', 'Consultation and X-ray'];
  const medicines = ['Fluoride mouthwash twice daily', 'Sensitivity toothpaste for 2 weeks', 'Orthodontic wax as needed', 'None needed',
    'Paracetamol 500 mg if pain, up to 3 days', 'Antibiotic course as prescribed; paracetamol if pain',
    'Antibiotic course as prescribed; paracetamol if pain', 'Chlorhexidine mouthwash twice daily for 1 week'];
  const banks = ['telebirr', 'cbe', 'abyssinia'];

  // items: [serviceIndex, slotIndex]. Completed visits get a medical record.
  function add(patient, date, bookingStatus, visitStatus, items) {
    const total = items.reduce((a, [si]) => a + svc[si].price, 0);
    const bid = db.prepare("INSERT INTO bookings(ref, patient_id, date, notes, status, source, deposit) VALUES(?,?,?,'',?, 'online', ?)")
      .run(makeRef(), patient, date, bookingStatus, depositFor(total, 0)).lastInsertRowid;
    items.forEach(([si, slot]) => {
      const s = svc[si], done = visitStatus === 'completed';
      try {
        db.prepare(`INSERT INTO visits(booking_id, doctor_id, service_id, date, time, status, diagnosis, treatment, medicines, completed_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)`).run(bid, s.doctor_id, s.id, date, SLOTS[slot], visitStatus,
          done ? diagnosis[si] : null, done ? treatment[si] : null, done ? medicines[si] : null, done ? date : null);
      } catch (e) { /* slot already used, skip */ }
    });
    return bid;
  }
  const money = (bid, type, amount, method, ref, at) => L.recordPayment({ bookingId: bid, type, amount, method, ref, user: admin, at });

  for (let d = 14; d >= 1; d--) {
    const date = offsetDate(-d);
    if (isSunday(date)) continue;
    for (let k = 0; k < 1 + (d % 3); k++) {
      const si = (d + k * 3) % 8;
      const bid = add(ids[(d + k) % 6], date, 'completed', 'completed', [[si, (d * 2 + k * 5) % SLOTS.length]]);
      const dep = depositFor(svc[si].price, 0);
      money(bid, 'deposit', dep, banks[bid % 3], `DEMO-${bid}-D`, `${date}T06:30:00.000Z`);   // deposit, then the rest after treatment
      if (svc[si].price > dep) money(bid, 'final', svc[si].price - dep, 'cash', null, `${date}T13:00:00.000Z`);
    }
  }
  const t = offsetDate(0), tm = offsetDate(1);
  // Upcoming bookings in different money states, so the demo shows every screen.
  let b = add(ids[0], t, 'confirmed', 'scheduled', [[0, 2], [4, 3]]);
  money(b, 'deposit', 230, 'cbe', 'FT20481DEMO');
  b = add(ids[1], t, 'confirmed', 'scheduled', [[5, 4]]);
  money(b, 'deposit', 450, 'telebirr', 'TB11870234');
  money(b, 'partial', 1500, 'cash', null);
  b = add(ids[2], t, 'pending', 'scheduled', [[1, 6]]);
  L.submitDeposit(b, 'telebirr', 'TB48213907');
  b = add(ids[3], tm, 'confirmed', 'scheduled', [[2, 1]]);
  money(b, 'deposit', 100, 'abyssinia', 'BOA77120DEMO');
  b = add(ids[4], tm, 'pending', 'scheduled', [[3, 2]]);
  db.prepare("UPDATE bookings SET payment_status='unpaid', expires_at=? WHERE id=?").run(new Date(Date.now() + 2 * 3600000).toISOString(), b);
}

if (!db.prepare('SELECT 1 FROM doctors').get()) seedClinic();
L.migrateLegacy(); // copies money recorded by older versions into the ledger
if (SAMPLE && !db.prepare('SELECT 1 FROM patients').get()) seedDemo();

// Accounts from older versions may still use a default demo password. Say so loudly.
if (!DEMO) {
  const known = ['admin123', 'doctor123', 'reception123'];
  const weak = db.prepare('SELECT username, password_hash FROM users').all().filter((u) => known.some((p) => bcrypt.compareSync(p, u.password_hash)));
  if (weak.length) console.warn(`\nWARNING: these accounts still use a default demo password: ${weak.map((u) => u.username).join(', ')}.\nGive each one a new password with:  npm run staff -- reset <username>\n`);
}
