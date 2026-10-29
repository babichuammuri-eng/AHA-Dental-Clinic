// Staff account management from the command line (no passwords are stored in the code).
//   npm run staff -- list
//   npm run staff -- add <username> "<Display Name>" admin               (a reception account)
//   npm run staff -- add <username> "<Display Name>" doctor <doctorId>   (a doctor account)
//   npm run staff -- reset <username>                                    (new random password)
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');

const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randomPassword = () => Array.from({ length: 12 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const [cmd, a, b, c, d] = process.argv.slice(2);

if (cmd === 'list') {
  console.table(db.prepare('SELECT username, display_name AS name, role, doctor_id AS doctorId FROM users ORDER BY role, username').all());
} else if (cmd === 'add' && a && b && ['admin', 'doctor'].includes(c)) {
  if (c === 'doctor' && !db.prepare('SELECT 1 FROM doctors WHERE id=?').get(d)) { console.error('Give a valid doctor id.'); process.exit(1); }
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(a.toLowerCase())) { console.error('That username already exists.'); process.exit(1); }
  const password = randomPassword();
  db.prepare('INSERT INTO users(username, password_hash, role, display_name, doctor_id) VALUES(?,?,?,?,?)').run(a.toLowerCase(), bcrypt.hashSync(password, 10), c, b, c === 'doctor' ? Number(d) : null);
  console.log(`Created ${c} account.\nUsername: ${a.toLowerCase()}\nPassword: ${password}\nGive these to the staff member now. The password cannot be shown again.`);
} else if (cmd === 'reset' && a) {
  const password = randomPassword();
  const r = db.prepare('UPDATE users SET password_hash=? WHERE username=?').run(bcrypt.hashSync(password, 10), a.toLowerCase());
  console.log(r.changes ? `New password for ${a.toLowerCase()}: ${password}` : 'No such username.');
} else console.log('Commands: list | add <username> "<Display Name>" admin | add <username> "<Display Name>" doctor <doctorId> | reset <username>');
