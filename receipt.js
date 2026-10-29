// Receipts: the data, the printable web page and the downloadable PDF. Only verified records have receipts.
const PDFDocument = require('pdfkit');
const db = require('../db');
const config = require('../config');
const { methodName } = require('./ledger');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const etb = (n) => `${Number(n).toLocaleString('en-US')} ETB`;
const stamp = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Addis_Ababa', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const longDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });

// Everything printed on a receipt. Totals come from the snapshot frozen when the payment was verified.
function receiptData(id) {
  const y = db.prepare('SELECT y.*, u.display_name AS verifier FROM payments y LEFT JOIN users u ON u.id = y.verified_by WHERE y.id=?').get(id);
  if (!y || y.status !== 'verified' || !y.receipt_no) return null;
  const b = db.prepare('SELECT ref, date FROM bookings WHERE id=?').get(y.booking_id);
  const p = db.prepare('SELECT name, phone FROM patients WHERE id=?').get(y.patient_id);
  const snap = JSON.parse(y.snapshot || '{}');
  const original = y.related_payment_id ? db.prepare('SELECT receipt_no FROM payments WHERE id=?').get(y.related_payment_id) : null;
  return {
    id: y.id, clinic: config.clinic, number: y.receipt_no, label: y.label, type: y.type, issuedAt: y.verified_at, paidAt: y.paid_at,
    patient: p, booking: b, items: snap.items || [], total: snap.total || 0, discounts: snap.discounts || 0, due: snap.due || 0,
    amount: y.amount, cumulative: y.cumulative_paid, balance: y.balance_after, method: methodName(y.method), reference: y.transaction_ref || '',
    verifiedBy: y.verifier || 'Migrated record', reason: y.reason || '', originalReceipt: original ? original.receipt_no : ''
  };
}

// The clear sentence at the bottom. A deposit is never described as full settlement.
function noteFor(d) {
  if (d.label === 'Paid in Full') return 'This account is paid in full. Thank you for choosing ' + d.clinic.name + '.';
  if (d.label === 'Deposit') return `This is a deposit receipt, not a full settlement. Remaining balance to pay: ${etb(d.balance)}.`;
  if (d.label === 'Refund') return `This document records a refund${d.reason ? ' (' + d.reason + ')' : ''}${d.originalReceipt ? ' of receipt ' + d.originalReceipt : ''}.`;
  return `Partial payment received. Remaining balance to pay: ${etb(d.balance)}.`;
}
const received = (d) => (d.label === 'Refund' ? 'Amount refunded' : 'Amount received (this transaction)');
const cumulativeLabel = (d) => (d.label === 'Refund' ? 'Net paid to date' : 'Total paid to date');

function renderReceiptHTML(d) {
  const row = (k, v, cls = '') => `<div class="row ${cls}"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
  const klass = { 'Paid in Full': 'full', Deposit: 'dep', 'Partial Payment': 'part', Refund: 'ref' }[d.label] || 'dep';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipt ${esc(d.number)} · ${esc(d.clinic.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Figtree:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--ink:#12302e;--deep:#0c2b2a;--teal:#0f766e;--mint:#8fe0cb;--muted:#4b6663;--line:#d6e2df}
*{box-sizing:border-box;margin:0}
body{font:400 15px/1.55 Figtree,system-ui,sans-serif;color:var(--ink);background:#eef6f5;padding:1rem}
.bar{max-width:820px;margin:0 auto 1rem;display:flex;justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap}
.bar a{color:var(--ink)}.bar a.btn{color:#fff}.bar div{display:flex;gap:.5rem}
.btn{font:600 14px Figtree,system-ui,sans-serif;padding:.6rem 1.1rem;border-radius:10px;border:1.5px solid var(--teal);background:var(--teal);color:#fff;text-decoration:none;cursor:pointer}
.btn.ghost{background:#fff;color:var(--ink);border-color:var(--line)}
.sheet{max-width:820px;margin:0 auto;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 14px 40px -18px rgba(18,48,46,.4)}
.head{background:var(--deep);color:#fff;padding:1.6rem 2rem;display:flex;justify-content:space-between;gap:1.5rem;flex-wrap:wrap}
.brand{display:flex;gap:.8rem;align-items:center}.brand i{width:42px;height:42px;border-radius:50%;background:var(--mint);display:grid;place-items:center}
.brand svg{width:24px}.brand h1{font:700 1.6rem 'Bricolage Grotesque',Figtree,system-ui,sans-serif;letter-spacing:-.02em;line-height:1.1}
.brand p{color:var(--mint);font-size:.9rem}.contact{font-size:.85rem;color:#cfe3df;text-align:right}
.body{padding:1.8rem 2rem 2rem}
.title{display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:1.2rem}
.kicker{font-size:.8rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.title h2{font:700 1.7rem 'Courier New',monospace;letter-spacing:.04em}
.pill{padding:.35rem 1.1rem;border-radius:99px;font-weight:700;font-size:.95rem;border:2px solid}
.pill.dep{color:#7a5a00;background:#fff1cc;border-color:#e8a33d}.pill.part{color:#26408b;background:#dde7ff;border-color:#2563eb}
.pill.full{color:#fff;background:var(--teal);border-color:var(--teal)}.pill.ref{color:#b42318;background:#fde1de;border-color:#b42318}
.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;padding:1rem 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.meta small{display:block;color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.08em}.meta b{font-weight:600}
table{width:100%;border-collapse:collapse;margin:1.2rem 0}
th{text-align:left;font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);padding:.5rem 0;border-bottom:2px solid var(--ink)}
td{padding:.6rem 0;border-bottom:1px solid var(--line)}th:last-child,td:last-child{text-align:right}
.sum{margin-left:auto;max-width:440px}.row{display:flex;justify-content:space-between;gap:1rem;padding:.35rem 0}.row b{white-space:nowrap}
.row.big{background:#e3f6f1;margin:.4rem -.8rem;padding:.7rem .8rem;border-radius:10px;font-size:1.1rem}
.row.line{border-top:1px solid var(--line);margin-top:.3rem;padding-top:.6rem}
.pay{margin-top:1.4rem;padding:1rem 1.2rem;border-radius:12px;background:#f4f8f7;display:grid;grid-template-columns:repeat(2,1fr);gap:.4rem 1.5rem}
.pay small{color:var(--muted)}.pay b{font-weight:600;word-break:break-all}
.note{margin-top:1.2rem;padding:.9rem 1.1rem;border-radius:12px;font-weight:500;border-left:5px solid var(--teal);background:#e3f6f1}
.note.dep{border-color:#e8a33d;background:#fff6dc}.note.ref{border-color:#b42318;background:#fde9e6}
.foot{margin-top:1.4rem;font-size:.8rem;color:var(--muted);text-align:center}
@media(max-width:640px){.head,.body{padding:1.2rem}.contact{text-align:left}.meta{grid-template-columns:1fr 1fr}.pay{grid-template-columns:1fr}}
@media print{@page{size:A4;margin:12mm}body{background:#fff;padding:0}.bar{display:none}.sheet{box-shadow:none;border-radius:0;max-width:none}
.head,.pill,.row.big,.note,.pay{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<div class="bar"><a href="/staff/reception">Back to the dashboard</a>
  <div><button class="btn ghost" id="print" type="button">Print</button><a class="btn" href="/api/admin/payments/${d.id}/receipt.pdf">Download PDF</a></div></div>
<main class="sheet">
  <div class="head"><div class="brand"><i><svg viewBox="0 0 24 24" fill="none" stroke="#12302e" stroke-width="2.6" stroke-linecap="round"><path d="M4 9q8 12 16 0"/></svg></i>
    <div><h1>${esc(d.clinic.name)}</h1><p>${esc(d.clinic.tagline)}</p></div></div>
    <div class="contact">${esc(d.clinic.address)}<br>${esc(d.clinic.phone)}<br>${esc(d.clinic.email)}</div></div>
  <div class="body">
    <div class="title"><div><span class="kicker">${d.label === 'Refund' ? 'Refund receipt' : 'Payment receipt'}</span><h2>${esc(d.number)}</h2></div>
      <span class="pill ${klass}">${esc(d.label)}</span></div>
    <div class="meta">
      <div><small>Patient</small><b>${esc(d.patient.name)}</b><br>${esc(d.patient.phone)}</div>
      <div><small>Booking reference</small><b>${esc(d.booking.ref)}</b><br>Visit ${esc(longDate(d.booking.date))}</div>
      <div><small>Date issued</small><b>${esc(stamp(d.issuedAt))}</b></div></div>
    <table><thead><tr><th>Service</th><th>Price</th></tr></thead><tbody>
      ${d.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(etb(i.price))}</td></tr>`).join('')}</tbody></table>
    <div class="sum">
      ${row('Total treatment cost', etb(d.total))}
      ${d.discounts ? row('Authorized discount', '- ' + etb(d.discounts)) + row('Amount due', etb(d.due)) : ''}
      ${row(received(d), (d.label === 'Refund' ? '- ' : '') + etb(d.amount), 'big')}
      ${row(cumulativeLabel(d), etb(d.cumulative), 'line')}
      ${row('Remaining balance', d.balance === 0 ? 'None (paid in full)' : etb(d.balance))}</div>
    <div class="pay">
      <div><small>Payment method</small><br><b>${esc(d.method || 'n/a')}</b></div>
      <div><small>Transaction reference</small><br><b>${esc(d.reference || 'Not applicable')}</b></div>
      <div><small>Payment date</small><br><b>${esc(stamp(d.paidAt))}</b></div>
      <div><small>Verified by</small><br><b>${esc(d.verifiedBy)}</b></div></div>
    <p class="note ${klass === 'dep' || klass === 'part' ? 'dep' : klass === 'ref' ? 'ref' : ''}">${esc(noteFor(d))}</p>
    <p class="foot">${esc(d.clinic.name)} · ${esc(d.clinic.hours)}<br>Please keep this receipt. It is valid only with its receipt number from the clinic's system.</p>
  </div></main>
<script src="/js/print.js"></script></body></html>`;
}

// The same receipt as a PDF (A4), drawn with the website colours.
function renderReceiptPDF(d, res) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Receipt ${d.number}`, Author: d.clinic.name } });
  doc.pipe(res);
  const W = 595.28, M = 48, R = W - M;
  const C = { ink: '#12302e', deep: '#0c2b2a', teal: '#0f766e', mint: '#8fe0cb', muted: '#4b6663', line: '#d6e2df', soft: '#e3f6f1' };
  const pill = { 'Paid in Full': ['#0f766e', '#ffffff'], Deposit: ['#fff1cc', '#7a5a00'], 'Partial Payment': ['#dde7ff', '#26408b'], Refund: ['#fde1de', '#b42318'] }[d.label];

  doc.rect(0, 0, W, 118).fill(C.deep);
  doc.circle(M + 18, 46, 18).fill(C.mint);
  doc.lineWidth(2.4).strokeColor(C.ink).moveTo(M + 8, 41).bezierCurveTo(M + 13, 56, M + 23, 56, M + 28, 41).stroke();
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(21).text(d.clinic.name, M + 48, 32);
  doc.fillColor(C.mint).font('Helvetica').fontSize(10).text(d.clinic.tagline, M + 48, 58);
  doc.fillColor('#cfe3df').fontSize(9).text(`${d.clinic.address}  |  ${d.clinic.phone}  |  ${d.clinic.email}`, M, 92, { width: R - M });

  doc.fillColor(C.muted).font('Helvetica').fontSize(8.5).text(d.label === 'Refund' ? 'REFUND RECEIPT' : 'PAYMENT RECEIPT', M, 142, { characterSpacing: 1.5 });
  doc.fillColor(C.ink).font('Courier-Bold').fontSize(19).text(d.number, M, 156);
  const pw = doc.font('Helvetica-Bold').fontSize(11).widthOfString(d.label) + 30;
  doc.roundedRect(R - pw, 148, pw, 26, 13).fill(pill[0]);
  doc.fillColor(pill[1]).text(d.label, R - pw, 155, { width: pw, align: 'center' });

  doc.moveTo(M, 192).lineTo(R, 192).lineWidth(0.8).strokeColor(C.line).stroke();
  const block = (x, label, v1, v2) => {
    doc.fillColor(C.muted).font('Helvetica').fontSize(7.5).text(label.toUpperCase(), x, 202, { characterSpacing: 1 });
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(10.5).text(v1, x, 215, { width: 160 });
    doc.font('Helvetica').fontSize(9).fillColor(C.muted).text(v2 || '', x, 230, { width: 160 });
  };
  block(M, 'Patient', d.patient.name, d.patient.phone);
  block(M + 180, 'Booking reference', d.booking.ref, 'Visit ' + longDate(d.booking.date));
  block(M + 360, 'Date issued', stamp(d.issuedAt), '');
  doc.moveTo(M, 258).lineTo(R, 258).strokeColor(C.line).stroke();

  let y = 276;
  doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8).text('SERVICE', M, y, { characterSpacing: 1 }).text('PRICE', R - 120, y, { width: 120, align: 'right', characterSpacing: 1 });
  doc.moveTo(M, y + 14).lineTo(R, y + 14).lineWidth(1.5).strokeColor(C.ink).stroke();
  y += 24;
  d.items.forEach((i) => {
    doc.fillColor(C.ink).font('Helvetica').fontSize(10.5).text(i.name, M, y).text(etb(i.price), R - 140, y, { width: 140, align: 'right' });
    doc.moveTo(M, y + 18).lineTo(R, y + 18).lineWidth(0.6).strokeColor(C.line).stroke();
    y += 26;
  });

  y += 10;
  const lx = W - M - 300;
  const line = (k, v, bold) => {
    doc.fillColor(bold ? C.ink : C.muted).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10.5).text(k, lx, y, { width: 170 }).text(v, lx + 150, y, { width: 150, align: 'right' });
    y += 20;
  };
  line('Total treatment cost', etb(d.total));
  if (d.discounts) { line('Authorized discount', '- ' + etb(d.discounts)); line('Amount due', etb(d.due)); }
  doc.roundedRect(lx - 10, y - 4, 310, 30, 8).fill(C.soft);
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(11).text(received(d), lx, y + 4, { width: 190 }).text((d.label === 'Refund' ? '- ' : '') + etb(d.amount), lx + 150, y + 4, { width: 150, align: 'right' });
  y += 38;
  line(cumulativeLabel(d), etb(d.cumulative));
  line('Remaining balance', d.balance === 0 ? 'None (paid in full)' : etb(d.balance), true);

  y += 16;
  doc.roundedRect(M, y, R - M, 76, 10).fill('#f4f8f7');
  const cell = (x, yy, k, v) => {
    doc.fillColor(C.muted).font('Helvetica').fontSize(8).text(k, x, yy);
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(10).text(v, x, yy + 11, { width: 230 });
  };
  cell(M + 16, y + 12, 'Payment method', d.method || 'n/a');
  cell(M + 266, y + 12, 'Transaction reference', d.reference || 'Not applicable');
  cell(M + 16, y + 44, 'Payment date', stamp(d.paidAt));
  cell(M + 266, y + 44, 'Verified by', d.verifiedBy);

  y += 96;
  const warm = ['Deposit', 'Partial Payment'].includes(d.label), red = d.label === 'Refund';
  const text = noteFor(d);
  const h = doc.font('Helvetica-Bold').fontSize(10.5).heightOfString(text, { width: R - M - 36 }) + 20;
  doc.roundedRect(M, y, R - M, h, 8).fill(red ? '#fde9e6' : warm ? '#fff6dc' : C.soft);
  doc.rect(M, y, 5, h).fill(red ? '#b42318' : warm ? '#e8a33d' : C.teal);
  doc.fillColor(C.ink).text(text, M + 18, y + 10, { width: R - M - 36 });

  doc.fillColor(C.muted).font('Helvetica').fontSize(8.5)
    .text(`${d.clinic.name}  |  ${d.clinic.hours}`, M, 770, { width: R - M, align: 'center' })
    .text("Please keep this receipt. It is valid only with its receipt number from the clinic's system.", M, 783, { width: R - M, align: 'center' });
  doc.end();
}

module.exports = { receiptData, renderReceiptHTML, renderReceiptPDF };
