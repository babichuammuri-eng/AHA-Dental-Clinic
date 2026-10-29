/* "My booking" page: find a booking by reference, phone, or both; pay the deposit; cancel. */
(function () {
  const params = new URLSearchParams(location.search);
  if (params.get('ref')) $('#ref').value = params.get('ref');

  // Full view: the patient proved ownership with the reference number.
  function showFull(b) {
    const stages = ['Requested', 'Confirmed', 'Completed'];
    const reached = { pending: 0, confirmed: 1, completed: 2 }[b.status];
    const timeline = ['cancelled', 'no_show'].includes(b.status)
      ? `<p class="err" style="margin:1rem 0">${b.status === 'no_show' ? 'This visit was marked as missed.' : 'This booking was cancelled.'}</p>`
      : `<ol class="timeline">${stages.map((s, i) => `<li class="${i <= reached ? 'done' : ''}">${s}</li>`).join('')}</ol>`;
    const canCancel = ['pending', 'confirmed'].includes(b.status) && !b.visits.some((v) => v.status === 'completed');
    const box = $('#result');
    box.hidden = false;
    box.innerHTML = `<hr style="border:0;border-top:1px solid var(--line);margin:1.4rem 0">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem"><div><div class="hint">Reference</div><div class="ref" style="font-size:1.4rem;margin:0">${esc(b.ref)}</div></div>${badge(b.status)}</div>
      ${timeline}
      <p><b>${esc(b.patient.name)}</b> · ${fmtDate(b.date)}</p>
      <ul class="plan">${b.visits.map((v) => `<li><b>${v.time}</b><span>${esc(v.service)}<br><small>${esc(v.doctor)} ${v.status === 'cancelled' ? '· cancelled' : ''}</small></span></li>`).join('')}</ul>
      <div id="payBox"></div>
      ${canCancel ? '<button class="btn danger block" id="cancel" type="button">Cancel this booking</button>' : ''}`;
    renderPayment($('#payBox'), b, showFull);
    if (canCancel) $('#cancel').onclick = async () => {
      const warning = b.payment.status === 'paid' ? ' Cancelling less than 24 hours before the visit forfeits your deposit.' : '';
      if (!confirm('Cancel this booking?' + warning)) return;
      try { showFull(await api('/api/bookings/cancel', 'POST', { ref: b.ref, phone: $('#phone').value })); toast('Booking cancelled'); }
      catch (err) { toast(err.message, true); }
    };
  }

  // View-only list: a phone number alone is easy to guess, so details are hidden and nothing can be changed.
  function showList(list) {
    const box = $('#result');
    box.hidden = false;
    box.innerHTML = `<hr style="border:0;border-top:1px solid var(--line);margin:1.4rem 0">
      <p class="hint">Showing a summary for this phone number. To cancel, pay a deposit or see full details, enter your reference number.</p>
      ${list.map((b) => `<div class="mini"><div style="display:flex;justify-content:space-between;gap:1rem"><span class="ref">${esc(b.ref)}</span>${badge(b.status)}</div>
        <div class="hint">${fmtDate(b.date)} · ${b.visits.map((v) => v.time + ' ' + esc(v.service)).join(', ')}</div></div>`).join('')}`;
  }

  $('#lookupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#msg').textContent = '';
    try {
      const r = await api('/api/bookings/lookup', 'POST', { ref: $('#ref').value, phone: $('#phone').value });
      r.bookings[0].view_only ? showList(r.bookings) : showFull(r.bookings[0]);
    } catch (err) { $('#result').hidden = true; $('#msg').textContent = err.message; }
  });
  if (params.get('ref') && $('#phone').value === '') $('#lookupForm').requestSubmit();
})();
