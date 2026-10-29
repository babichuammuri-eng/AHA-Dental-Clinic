/* Reception dashboard: statistics, bookings, payment ledger and receipts, patients. */
(async function () {
  const { user } = await api('/api/auth/me');
  if (!user || user.role !== 'admin') return location.replace('/staff-login');
  initTheme($('#theme'));
  $('#logout').onclick = signOut;
  const call = authApi;
  let tab = 'bookings', ledgerId = null, ledgerData = null;

  const info = await call('/api/payment-info');
  const METHODS = [['cash', 'Cash'], ...info.methods.map((m) => [m.id, m.name])];
  const methodLabel = (id) => (METHODS.find((m) => m[0] === id) || [id, id])[1];
  const methodOptions = METHODS.map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('');
  $('#rMethod').innerHTML = methodOptions; $('#fMethod').innerHTML = methodOptions;

  // Badge for the money status of a booking.
  const SETTLE = { 'Paid in full': 'paid', 'Partially paid': 'submitted', 'Awaiting verification': 'submitted', Unpaid: 'unpaid',
    'Refund due': 'refund_due', Refunded: 'refunded', 'Deposit kept': 'forfeited', Cancelled: 'cancelled' };
  const settleBadge = (s) => `<span class="badge ${SETTLE[s] || ''}">${esc(s)}</span>`;
  const TYPE_NAME = { deposit: 'Deposit', partial: 'Partial payment', final: 'Final payment', refund: 'Refund', adjustment: 'Discount' };

  // ---------- Statistics ----------
  async function loadStats() {
    const s = await call('/api/admin/stats');
    $('#stats').innerHTML = [['Payments to verify', s.toVerify], ['Waiting for confirmation', s.pending], ['Visits today', s.today], ['Collected (net of refunds)', money(s.collected)]]
      .map(([label, value], i) => `<div class="stat glass"${i === 0 && s.toVerify ? ' style="border-color:#e8a33d"' : ''}><b>${value}</b><span>${label}</span></div>`).join('');
    barChart($('#chartDay'), s.perDay);
    hbarChart($('#chartDoctor'), s.byDoctor.map((d) => ({ label: shortName(d.label), value: d.value })));
    hbarChart($('#chartService'), s.byService.slice(0, 5));
  }

  // ---------- Bookings ----------
  function payLine(b) {
    const m = b.money, p = b.payment;
    const waiting = p.status === 'submitted' && p.method ? ` · ${esc(methodLabel(p.method))} <b>${esc(p.ref)}</b> (not verified yet)` : '';
    const hold = p.status === 'unpaid' && p.expires_at ? ` · slot held until ${clock(p.expires_at)}` : '';
    return `<div class="paid-line">Total ${money(m.total)} · Paid ${money(m.netPaid)} · Balance ${money(m.balance)} ${settleBadge(m.settlement)}${waiting}${hold}</div>`;
  }

  function actions(b) {
    const p = b.payment.status, btn = (act, label, cls = 'ghost') => `<button class="btn ${cls} sm" data-act="${act}" data-id="${b.id}">${label}</button>`;
    const out = [];
    if (b.status === 'pending') {
      if (p === 'submitted') out.push(btn('verify', 'Verify payment and confirm', ''), btn('reject', 'Reject payment', 'danger'));
      else if (['unpaid', 'rejected'].includes(p)) out.push(btn('confirm-waive', 'Confirm without deposit'));
      else out.push(btn('confirm', 'Confirm', ''));
    }
    if (b.status === 'confirmed') out.push(btn('no_show', 'No-show'));
    if (['pending', 'confirmed'].includes(b.status)) out.push(btn('cancel', 'Cancel', 'danger'));
    out.push(btn('ledger', b.money.refundOwed ? 'Refund due' : 'Payments', b.money.refundOwed ? '' : 'ghost'));
    out.push(`<button class="btn ghost sm" data-act="history" data-patient="${b.patient.id}">Record</button>`);
    if (!['verified'].includes(p) && b.money.paid === 0 && b.money.pending === 0 && !b.money.refunded) out.push(btn('delete', 'Delete'));
    return out.join('');
  }

  async function loadBookings() {
    const p = new URLSearchParams();
    if ($('#q').value) p.set('q', $('#q').value);
    if ($('#fd').value) p.set('date', $('#fd').value);
    if ($('#fs').value) p.set('status', $('#fs').value);
    const rows = await call('/api/admin/bookings?' + p);
    $('#bookingList').innerHTML = rows.length ? rows.map((b) => `<article class="item-card glass">
      <div><h3>${esc(b.patient.name)}</h3><div class="meta">${esc(b.patient.phone)} · ${esc(b.ref)} · ${esc(b.source)}</div>
        <div style="margin-top:.4rem">${badge(b.status)}${b.patient.no_shows ? ` <span class="tag">${b.patient.no_shows} no-show${b.patient.no_shows > 1 ? 's' : ''}</span>` : ''}</div></div>
      <div><div class="meta">${fmtDate(b.date)}${b.notes ? ' · ' + esc(b.notes) : ''}</div>
        <ul>${b.visits.map((v) => `<li${v.status === 'cancelled' ? ' style="opacity:.5;text-decoration:line-through"' : ''}><b>${v.time}</b> ${esc(v.service)} · ${esc(shortName(v.doctor))}</li>`).join('')}</ul>${payLine(b)}</div>
      <div class="actions">${actions(b)}</div></article>`).join('') : '<p class="empty">No bookings match.</p>';
  }

  // ---------- Payments and receipts tab ----------
  async function loadPayments() {
    const rows = await call('/api/admin/payments?q=' + encodeURIComponent($('#yq').value));
    const want = $('#ys').value;
    const list = want ? rows.filter((r) => r.money.settlement === want) : rows;
    $('#paymentList').innerHTML = list.length ? list.map((r) => `<article class="item-card glass">
      <div><h3>${esc(r.patient.name)}</h3><div class="meta">${esc(r.patient.phone)} · ${esc(r.ref)} · ${fmtDate(r.date)}</div>
        <div style="margin-top:.4rem">${settleBadge(r.money.settlement)}${r.receipts ? ` <span class="tag">${r.receipts} receipt${r.receipts > 1 ? 's' : ''}</span>` : ''}</div></div>
      <div class="paygrid"><div><span>Treatment total</span><b>${money(r.money.total)}</b></div><div><span>Deposit required</span><b>${money(r.money.deposit)}</b></div>
        <div><span>Verified paid (net)</span><b>${money(r.money.netPaid)}</b></div><div><span>Outstanding balance</span><b>${money(r.money.balance)}</b></div></div>
      <div class="actions"><button class="btn sm" data-act="ledger" data-id="${r.id}">Ledger and receipts</button></div></article>`).join('')
      : '<p class="empty">No bookings match your search.</p>';
  }

  // ---------- Patients tab ----------
  async function loadPatients() {
    const rows = await call('/api/admin/patients?q=' + encodeURIComponent($('#pq').value));
    $('#patientList').innerHTML = rows.length ? rows.map((p) => `<article class="item-card glass">
      <div><h3>${esc(p.name)}</h3><div class="meta">${esc(p.phone)}</div></div>
      <div class="meta">${p.visits} completed visit${p.visits === 1 ? '' : 's'}${p.last_visit ? ' · last ' + fmtDate(p.last_visit) : ''}
        ${p.allergies ? `<div class="err">Allergies: ${esc(p.allergies)}</div>` : ''}</div>
      <div class="actions"><button class="btn ghost sm" data-act="history" data-patient="${p.id}">Record</button>
        <button class="btn ghost sm" data-act="patpay" data-patient="${p.id}">Payment history</button></div></article>`).join('')
      : '<p class="empty">No patients found.</p>';
  }

  const loaders = { bookings: loadBookings, payments: loadPayments, patients: loadPatients };
  const refresh = async () => {
    await Promise.all([loadStats(), loaders[tab]()]).catch(() => {});
    if ($('#ledgerDlg').open && ledgerId) openLedger(ledgerId).catch(() => {});
  };

  // ---------- Payment ledger dialog ----------
  const receiptLinks = (p) => p.has_receipt
    ? `<a class="btn ghost sm" href="/staff/receipts/${p.id}" target="_blank" rel="noopener">View / print receipt</a><a class="btn ghost sm" href="/api/admin/payments/${p.id}/receipt.pdf">Download PDF</a>` : '';

  function txn(p) {
    const isRefund = p.type === 'refund';
    const title = p.status === 'verified' ? (p.label || TYPE_NAME[p.type]) : `${TYPE_NAME[p.type]} (${p.status === 'pending' ? 'not verified yet' : 'rejected'})`;
    const when = p.status === 'verified' ? `Verified by ${esc(p.verified_by)} on ${stamp(p.verified_at)}` : p.status === 'rejected'
      ? `Rejected${p.rejected_by ? ' by ' + esc(p.rejected_by) : ''} ${stamp(p.rejected_at)}` : `Submitted ${stamp(p.paid_at)}`;
    const how = p.type === 'adjustment' ? '' : ` · ${esc(p.method_name)}${p.transaction_ref ? ' <b>' + esc(p.transaction_ref) + '</b>' : ''}`;
    const acts = [];
    if (p.status === 'pending') acts.push(`<button class="btn sm" data-lact="verify" data-id="${p.id}">Verify payment</button>`, `<button class="btn danger sm" data-lact="reject" data-id="${p.id}">Reject</button>`);
    if (p.refundable > 0) acts.push(`<button class="btn ghost sm" data-lact="refund" data-id="${p.id}" data-max="${p.refundable}" data-label="${esc(p.label || TYPE_NAME[p.type])} ${esc(p.receipt_no)}">Refund</button>`);
    return `<div class="txn ${p.status}"><div class="txn-top"><span><b>${esc(title)}</b> ${badge(p.status)}</span>
      <span class="amt ${isRefund ? 'neg' : ''}">${isRefund ? '- ' : p.type === 'adjustment' ? '- ' : ''}${money(p.amount)}</span></div>
      <div class="meta">${esc(p.payment_no)}${p.receipt_no ? ' · Receipt <b>' + esc(p.receipt_no) + '</b>' : ''}${how}</div>
      <div class="meta">${when}${p.reason ? ' · Reason: ' + esc(p.reason) : ''}${p.note ? ' · ' + esc(p.note) : ''}</div>
      ${p.status === 'verified' && p.type !== 'adjustment' ? `<div class="meta">Total paid after this: ${money(p.cumulative_paid)} · Balance after: ${money(p.balance_after)}</div>` : ''}
      <div class="actions">${receiptLinks(p)}${acts.join('')}</div></div>`;
  }

  async function openLedger(id) {
    const d = await call(`/api/admin/bookings/${id}/payments`);
    ledgerId = id; ledgerData = d;
    const m = d.money, closed = ['cancelled', 'no_show'].includes(d.booking.status);
    const tile = (k, v, cls = '') => `<div class="mtile ${cls}"><span>${k}</span><b>${v}</b></div>`;
    $('#ledgerBody').innerHTML = `<h2>${esc(d.patient.name)}</h2>
      <p class="hint">${esc(d.booking.ref)} · ${fmtDate(d.booking.date)} · ${esc(d.patient.phone)} ${badge(d.booking.status)} ${settleBadge(m.settlement)}</p>
      <div class="mtiles">${tile('Treatment total', money(m.total))}${m.discounts ? tile('Discounts', '- ' + money(m.discounts)) : ''}${tile('Amount due', money(m.due))}
        ${tile('Verified paid (net)', money(m.netPaid), 'good')}${m.refunded ? tile('Refunded', money(m.refunded)) : ''}${m.pending ? tile('Not verified yet', money(m.pending), 'warn') : ''}
        ${tile('Remaining balance', money(m.balance), m.balance ? 'warn' : 'good')}</div>
      ${m.refundOwed ? `<p class="paynote warn" style="margin:.2rem 0 1rem">A refund of ${money(m.refundOwed)} is due. Use the Refund button on the payment below.</p>` : ''}
      ${d.payments.map(txn).join('') || '<p class="empty">No payments recorded yet.</p>'}`;
    $('#recBtn').disabled = closed || m.balance === 0;
    $('#adjBtn').disabled = closed || m.balance === 0;
    if (!$('#ledgerDlg').open) $('#ledgerDlg').showModal();
  }
  $('#ledgerClose').onclick = () => { $('#ledgerDlg').close(); ledgerId = null; };

  $('#ledgerBody').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-lact]');
    if (!b) return;
    try {
      if (b.dataset.lact === 'verify') {
        if (!confirm('Verify this payment? Only do this after you have seen the transaction in the clinic account.')) return;
        await call(`/api/admin/payments/${b.dataset.id}/verify`, 'POST'); toast('Payment verified. Receipt created.');
      } else if (b.dataset.lact === 'reject') {
        if (!confirm('Reject this payment? The transaction ID was not found in the clinic account.')) return;
        await call(`/api/admin/payments/${b.dataset.id}/reject`, 'POST', { reason: 'Transaction not found in the clinic account' }); toast('Payment rejected.');
      } else if (b.dataset.lact === 'refund') {
        openRefund(b.dataset.id, Number(b.dataset.max), b.dataset.label); return;
      }
      refresh();
    } catch (err) { if (![401, 403].includes(err.status)) toast(err.message, true); }
  });

  // ---------- Small forms: record payment, refund, discount ----------
  const closeBtns = () => $$('[data-close]').forEach((b) => { b.onclick = () => $('#' + b.dataset.close).close(); });
  closeBtns();
  const toggleRef = (method, box) => { box.hidden = method === 'cash'; };

  function openRecord() {
    const m = ledgerData.money;
    $('#recForm').dataset.key = uuid();
    $('#recSub').textContent = `${ledgerData.patient.name} · ${ledgerData.booking.ref} · balance ${money(m.balance)}`;
    $('#rType').value = m.netPaid === 0 ? 'deposit' : 'partial';
    $('#rMethod').value = 'cash'; $('#rRef').value = ''; $('#rNote').value = ''; $('#rErr').textContent = '';
    toggleRef('cash', $('#rRefBox'));
    setAmount(true);
    $('#recDlg').showModal();
  }
  function setAmount(reset) {
    const m = ledgerData.money, type = $('#rType').value;
    $('#rAmount').readOnly = type === 'final';
    if (type === 'final') $('#rAmount').value = m.balance;
    else if (reset || $('#rAmount').readOnly) $('#rAmount').value = type === 'deposit' ? Math.min(m.deposit || m.balance, m.balance) : '';
  }
  $('#recBtn').onclick = openRecord;
  $('#rType').onchange = () => setAmount(false);
  $('#rMethod').onchange = (e) => toggleRef(e.target.value, $('#rRefBox'));
  $('#recForm').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#rErr').textContent = '';
    try {
      await call(`/api/admin/bookings/${ledgerId}/payments`, 'POST', { type: $('#rType').value, amount: Number($('#rAmount').value), method: $('#rMethod').value,
        transaction_ref: $('#rRef').value, note: $('#rNote').value, idempotency_key: e.target.dataset.key });
      $('#recDlg').close(); toast('Payment verified and saved. Receipt created.'); refresh();
    } catch (err) { $('#rErr').textContent = err.message; }
  });

  function openRefund(paymentId, max, label) {
    const m = ledgerData.money, closed = ['cancelled', 'no_show'].includes(ledgerData.booking.status);
    $('#refForm').dataset.key = uuid(); $('#refForm').dataset.payment = paymentId;
    $('#refSub').textContent = `Refund of ${label}. At most ${money(Math.min(max, m.netPaid))} can be refunded.`;
    $('#fAmount').value = Math.min(max, m.netPaid); $('#fAmount').max = Math.min(max, m.netPaid);
    $('#fMethod').value = 'cash'; $('#fRef').value = ''; $('#fReason').value = closed ? 'Booking cancelled' : ''; $('#fErr').textContent = '';
    toggleRef('cash', $('#fRefBox'));
    $('#refDlg').showModal();
  }
  $('#fMethod').onchange = (e) => toggleRef(e.target.value, $('#fRefBox'));
  $('#refForm').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#fErr').textContent = '';
    try {
      await call(`/api/admin/payments/${e.target.dataset.payment}/refund`, 'POST', { amount: Number($('#fAmount').value), method: $('#fMethod').value,
        transaction_ref: $('#fRef').value, reason: $('#fReason').value, idempotency_key: e.target.dataset.key });
      $('#refDlg').close(); toast('Refund recorded. The original payment is unchanged.'); refresh();
    } catch (err) { $('#fErr').textContent = err.message; }
  });

  $('#adjBtn').onclick = () => {
    $('#adjForm').dataset.key = uuid();
    $('#adjSub').textContent = `${ledgerData.patient.name} · ${ledgerData.booking.ref}. A discount lowers the amount due (at most ${money(ledgerData.money.balance)}).`;
    $('#aAmount').value = ''; $('#aAmount').max = ledgerData.money.balance; $('#aReason').value = ''; $('#aErr').textContent = '';
    $('#adjDlg').showModal();
  };
  $('#adjForm').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#aErr').textContent = '';
    try {
      await call(`/api/admin/bookings/${ledgerId}/adjustments`, 'POST', { amount: Number($('#aAmount').value), reason: $('#aReason').value, idempotency_key: e.target.dataset.key });
      $('#adjDlg').close(); toast('Discount recorded.'); refresh();
    } catch (err) { $('#aErr').textContent = err.message; }
  });

  // ---------- Patient payment history ----------
  async function openPatientPayments(id) {
    const d = await call(`/api/admin/patients/${id}/payments`);
    $('#patPayBody').innerHTML = `<h2>${esc(d.patient.name)}</h2><p class="hint">${esc(d.patient.phone)} · payment history</p>
      <h3 style="font-size:1rem;margin:1rem 0 .5rem">Bookings</h3>
      ${d.bookings.map((b) => `<div class="txn"><div class="txn-top"><span><b>${esc(b.ref)}</b> · ${fmtDate(b.date)} ${badge(b.status)}</span>${settleBadge(b.money.settlement)}</div>
        <div class="meta">Total ${money(b.money.total)} · Paid (net) ${money(b.money.netPaid)} · Balance ${money(b.money.balance)}</div>
        <div class="actions"><button class="btn ghost sm" data-pp="${b.id}">Open ledger</button></div></div>`).join('') || '<p class="empty">No bookings.</p>'}
      <h3 style="font-size:1rem;margin:1rem 0 .5rem">All payments</h3>
      ${d.payments.map((p) => txn(p).replace('<div class="meta">' + esc(p.payment_no), `<div class="meta">${esc(p.booking_ref)} · ` + esc(p.payment_no)).replace(/<button[^>]*data-lact[^>]*>[^<]*<\/button>/g, '')).join('') || '<p class="empty">No payments yet.</p>'}`;
    $('#patPayDlg').showModal();
  }
  $('#patPayBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pp]');
    if (b) { $('#patPayDlg').close(); openLedger(b.dataset.pp).catch((err) => toast(err.message, true)); }
  });

  // ---------- Booking decisions ----------
  const DECISIONS = {
    verify: { body: { action: 'verify' }, ok: 'Payment verified. Booking confirmed and sent to the doctors.', ask: 'Verify this payment? Only do this after you have seen the transaction in the clinic account.' },
    reject: { body: { action: 'reject' }, ok: 'Payment rejected. The patient can try again.', ask: 'Reject this payment? Use this when the transaction ID is not in your account.' },
    confirm: { body: { action: 'confirm' }, ok: 'Confirmed and sent to the doctors.' },
    'confirm-waive': { body: { action: 'confirm', waive: true }, ok: 'Confirmed without a deposit.', ask: 'Confirm without a deposit? Only do this for patients you trust.' },
    cancel: { body: { action: 'cancel' }, ok: 'Booking cancelled.', ask: 'Cancel this booking?' },
    no_show: { body: { action: 'no_show' }, ok: 'Marked as no-show. The deposit is kept.', ask: 'Mark this patient as a no-show? The deposit is kept and it is recorded on the patient.' }
  };

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    try {
      if (DECISIONS[act]) {
        const d = DECISIONS[act];
        if (d.ask && !confirm(d.ask)) return;
        await call(`/api/admin/bookings/${b.dataset.id}`, 'PATCH', d.body);
        toast(d.ok);
      } else if (act === 'delete') {
        if (!confirm('Delete this booking permanently? (Only bookings with no payment records can be deleted.)')) return;
        await call(`/api/admin/bookings/${b.dataset.id}`, 'DELETE');
      } else if (act === 'ledger') { return await openLedger(b.dataset.id); }
      else if (act === 'patpay') { return await openPatientPayments(b.dataset.patient); }
      else if (act === 'history') {
        const h = await call(`/api/admin/patients/${b.dataset.patient}/history`);
        $('#histBody').innerHTML = `<h2>${esc(h.patient.name)}</h2><p class="hint">${esc(h.patient.phone)}</p>
          ${h.patient.allergies ? `<p class="err">Allergies: ${esc(h.patient.allergies)}</p>` : ''}${historyHTML(h.history)}`;
        return $('#histDlg').showModal();
      }
      refresh();
    } catch (err) { if (![401, 403].includes(err.status)) toast(err.message, true); }
  });
  $('#histClose').onclick = () => $('#histDlg').close();

  // ---------- Tabs and filters ----------
  $$('.tabs button').forEach((t) => t.addEventListener('click', () => {
    tab = t.dataset.tab;
    $$('.tabs button').forEach((x) => x.setAttribute('aria-selected', x === t));
    ['bookings', 'payments', 'patients'].forEach((n) => { $('#tab' + n[0].toUpperCase() + n.slice(1)).hidden = tab !== n; });
    refresh();
  }));
  let timer;
  const later = (fn) => () => { clearTimeout(timer); timer = setTimeout(fn, 250); };
  ['q', 'fd', 'fs'].forEach((id) => $('#' + id).addEventListener('input', later(loadBookings)));
  $('#yq').addEventListener('input', later(loadPayments));
  $('#ys').addEventListener('input', loadPayments);
  $('#pq').addEventListener('input', later(loadPatients));

  // ---------- New booking (walk-in or phone booking: confirmed at once, no deposit needed) ----------
  const services = await call('/api/services');
  $('#nServices').innerHTML = services.map((s) => `<label class="check"><input type="checkbox" value="${s.id}"><span>${esc(s.name)}<small>${esc(shortName(s.doctor))}</small></span><b>${money(s.price)}</b></label>`).join('');
  const picked = () => $$('#nServices input:checked').map((i) => i.value);
  async function nSlots() {
    const date = $('#nDate').value, ids = picked();
    if (!date || !ids.length) { $('#nTime').innerHTML = '<option value="">Choose services and date</option>'; return; }
    const r = await call(`/api/slots?date=${date}&services=${ids.join(',')}`);
    $('#nTime').innerHTML = r.closed ? '<option value="">Closed on Sundays</option>' : r.slots.length ? r.slots.map((t) => `<option>${t}</option>`).join('') : '<option value="">Fully booked</option>';
  }
  $('#nServices').addEventListener('change', nSlots);
  $('#nDate').addEventListener('change', nSlots);
  $('#nDate').min = todayStr();
  $('#newBtn').onclick = () => { $('#newForm').reset(); $('#nErr').textContent = ''; nSlots(); $('#newDlg').showModal(); };
  $('#nCancel').onclick = () => $('#newDlg').close();
  $('#newForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await call('/api/admin/bookings', 'POST', { patient_name: $('#nName').value, phone: $('#nPhone').value, email: $('#nEmail').value,
        date: $('#nDate').value, time: $('#nTime').value, service_ids: picked(), notes: $('#nNotes').value });
      $('#newDlg').close(); toast('Booking saved and sent to the doctors'); refresh();
    } catch (err) { $('#nErr').textContent = err.message; }
  });

  refresh();
  // Reload every 30 seconds so new requests appear without refreshing (paused while a form is open).
  setInterval(() => { if (!document.querySelector('dialog[open]')) refresh(); }, 30000);
})();
