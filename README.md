# AHA Dental Clinic

```
aha-dental/
  frontend/    everything the browser shows (HTML, CSS, JavaScript, images)
    public/      the public website: home, booking, My booking, staff login page
    private/     reception and doctor pages (sent only after the server checks the sign-in)
  backend/     the server, the database and the API
    server.js, config.js, db.js, seed.js
    routes/  lib/  middleware/  scripts/
```

The backend serves the frontend files, so both run together at one address (this keeps sign-in cookies secure and simple).

## Run
1. Install Node.js 18 or newer (nodejs.org)
2. Open a terminal in the **backend** folder:
   ```
   cd backend
   npm install
   npm run demo      (presentations: known passwords and sample data)
   ```
   or `npm start` for real use (random passwords shown once and saved in `setup-credentials.txt`).
3. Open http://localhost:3000

To start from zero, stop the server and delete `backend/clinic.db`.

## Addresses
| Page | Address |
|---|---|
| Public website and booking | `/` |
| Check, pay or cancel a booking | `/booking.html` |
| Staff sign in (give this link to staff) | `/staff-login` |
| Reception dashboard | `/staff/reception` (after sign-in) |
| Doctor portal | `/staff/doctor` (after sign-in) |

## Demo accounts (`npm run demo` only)
| Role | Username | Password |
|---|---|---|
| Reception | reception | reception123 |
| Doctors | ammar, amanuel, hiwot, seada, faitha | doctor123 |

## Staff accounts (run in the backend folder)
```
npm run staff -- list
npm run staff -- add hanna "Hanna Tesfaye" admin
npm run staff -- add newdoc "Dr. New Name" doctor 3
npm run staff -- reset ammar
```

## Money, receipts and security
- Every payment, refund and discount is a separate ledger record (never overwritten). A transaction ID is only
  pending until reception verifies it. Verified payments can never exceed the amount due.
- Receipts (Deposit, Partial Payment, Paid in Full, Refund) can be printed or downloaded as PDF by reception.
- Staff pages, scripts and receipts are only sent after the server checks the session and role.
  Login is rate limited, cookies are httpOnly, and there are no built-in passwords in real mode.
- Before real use: set NODE_ENV=production and SESSION_SECRET, use HTTPS, and fill in the clinic's details and
  payment accounts in `backend/config.js`.

## Where to change things
| To change | Edit |
|---|---|
| Clinic name, address, phone, deposit rules, payment accounts | `backend/config.js` |
| Doctors and services | `backend/seed.js` (then delete `clinic.db`) |
| Opening hours | `SLOTS` in `backend/lib/scheduling.js` |
| Colours | variables at the top of `frontend/public/css/base.css` |
| Booking page behaviour | `frontend/public/js/home.js` |
| Reception dashboard | `frontend/private/js/admin.js` |

## Deploying (GitHub + Render)
GitHub stores the code. Render runs it. See `render.yaml` (settings are already written).
- Render settings: root directory `backend`, build `npm install`, start `npm start`.
- Private settings (set in Render, never in the code): `RECEPTION_PASSWORD`, and a password per doctor: `DOCTOR_PASSWORD_AMMAR`, `DOCTOR_PASSWORD_AMANUEL`, `DOCTOR_PASSWORD_HIWOT`, `DOCTOR_PASSWORD_SEADA`, `DOCTOR_PASSWORD_FAITHA` (or one `DOCTOR_PASSWORD` for all). Each at least 10 characters,
  `SESSION_SECRET` (Render can generate it), `NODE_ENV=production`, `NODE_VERSION=20`.
- Optional: `SAMPLE_DATA=1` adds sample patients and receipts (no known passwords). Remove it for the real clinic.
- Free plan: the site sleeps after 15 minutes without visitors, and **the database is erased on every restart or redeploy**.
  For real patients use a paid plan with a Persistent Disk (mount `/var/data`) and set `DATABASE_PATH=/var/data/clinic.db`.
- Never upload `clinic.db`, `setup-credentials.txt` or `.env` to GitHub (the included `.gitignore` blocks them).
