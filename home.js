/* Public home page: sections from the API and the 3-step booking wizard. */
(async function () {
  const [services, doctors] = await Promise.all([api('/api/services'), api('/api/doctors')]);
  const state = { chosen: new Set(), time: '', step: 1, phone: '' };

  // ----- Clinic details come from the server settings (one place to change them) -----
  api('/api/clinic').then((c) => {
    $('#clName').textContent = c.name; $('#clAddress').textContent = c.address; $('#clHours').textContent = c.hours; $('#clPhone').textContent = c.phone;
  }).catch(() => {});

  // ----- Page sections -----
  $('#photo').insertAdjacentHTML('afterbegin', '<img src="images/group.webp" alt="A group of people laughing together" width="474" height="353">');
  $('#gallery').innerHTML = [['man.webp', 'Smiling man with a beard', '50% 20%'], ['closeup.webp', 'Close-up of a healthy smile', '50% 60%'],
    ['woman.jpg', 'Smiling woman', '50% 25%'], ['group.webp', 'Friends laughing together', '50% 40%']]
    .map(([f, alt, pos]) => `<img src="images/${f}" alt="${alt}" style="object-position:${pos}" loading="lazy">`).join('');
  $('#serviceList').innerHTML = services.map((s) => `<div class="item glass"><h3>${esc(s.name)}</h3>
    <small>from ${money(s.price)}</small><p>${esc(s.description)}</p><p class="by">${esc(s.doctor)}</p></div>`).join('');
  $('#teamList').innerHTML = doctors.map((d) => `<article class="doc glass">${face(DOCTOR_LOOKS[(d.id - 1) % DOCTOR_LOOKS.length])}
    <h3>${esc(d.name)}</h3><div class="sp">${esc(d.specialty)}</div><p>${esc(d.bio)}</p></article>`).join('');

  // ----- Wizard -----
  $('#serviceChecks').innerHTML = services.map((s) => `<label class="check"><input type="checkbox" value="${s.id}">
    <span>${esc(s.name)}<small>${esc(s.doctor)}</small></span><b>${money(s.price)}</b></label>`).join('');
  $('#date').min = todayStr();

  const chosen = () => services.filter((s) => state.chosen.has(s.id));
  const total = () => chosen().reduce((sum, s) => sum + s.price, 0);

  function refresh() {
    const n = state.chosen.size;
    $('#total').textContent = n ? `${n} service${n > 1 ? 's' : ''} · from ${money(total())}` : 'Select at least one service';
    $('#next').disabled = (state.step === 1 && !n) || (state.step === 2 && !state.time);
  }

  function go(step) {
    state.step = step;
    $$('[data-step]').forEach((s) => { s.hidden = Number(s.dataset.step) !== step; });
    $$('.steps span').forEach((d, i) => d.classList.toggle('on', i < step));
    $('#back').hidden = step === 1;
    $('#next').textContent = step === 3 ? 'Request appointment' : 'Continue';
    $('#msg').textContent = '';
    if (step === 2) {
      $('#durationHint').textContent = `About ${state.chosen.size * 30} minutes. Services are scheduled back to back with the right doctors.`;
      loadSlots();
    }
    if (step === 3) {
      $('#planSummary').innerHTML = chosen().map((s) => `<li><span>${esc(s.name)}</span><span>${money(s.price)}</span></li>`).join('')
        + `<li class="sum-total"><span>${fmtDate($('#date').value)} at ${state.time}</span><span>${money(total())}</span></li>`;
    }
    refresh();
  }

  async function loadSlots() {
    state.time = '';
    refresh();
    const date = $('#date').value;
    if (!date) { $('#slots').innerHTML = '<span class="hint">Choose a date first.</span>'; return; }
    const r = await api(`/api/slots?date=${date}&services=${[...state.chosen].join(',')}`);
    if (r.closed) $('#slots').innerHTML = '<span class="hint">We are closed on Sundays. Pick another day.</span>';
    else if (!r.slots.length) $('#slots').innerHTML = '<span class="hint">No free time for this combination. Try another day.</span>';
    else $('#slots').innerHTML = r.slots.map((t) => `<button type="button" aria-pressed="false">${t}</button>`).join('');
  }

  $('#serviceChecks').addEventListener('change', (e) => {
    const id = Number(e.target.value);
    e.target.checked ? state.chosen.add(id) : state.chosen.delete(id);
    refresh();
  });
  $('#slots').addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    state.time = e.target.textContent;
    $$('#slots button').forEach((b) => b.setAttribute('aria-pressed', b === e.target));
    refresh();
  });
  $('#date').addEventListener('change', loadSlots);
  $('#back').onclick = () => go(state.step - 1);

  $('#wizard').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.step < 3) return go(state.step + 1);
    const msg = $('#msg');
    msg.className = 'err';
    state.phone = $('#phone').value;
    $('#next').disabled = true;
    try {
      const booking = await api('/api/bookings', 'POST', { patient_name: $('#name').value, phone: state.phone, email: $('#email').value,
        date: $('#date').value, time: state.time, service_ids: [...state.chosen], notes: $('#notes').value, website: $('#website').value });
      showDone(booking);
    } catch (err) {
      msg.textContent = err.message;
      if (/time|slot/i.test(err.message)) go(2);
      $('#next').disabled = false;
    }
  });

  // ----- Confirmation screen (also shows the deposit panel) -----
  const tickSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
  const crossSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function showDone(b) {
    $('#wizard').hidden = true;
    const done = $('#done');
    done.hidden = false;
    const cancelled = b.status === 'cancelled';
    const open = ['pending', 'confirmed'].includes(b.status);
    done.innerHTML = `<div class="tick ${cancelled ? 'bad' : ''}">${cancelled ? crossSvg : tickSvg}</div>
      <h2>${cancelled ? 'Booking cancelled' : 'Request received'}</h2>
      <p class="hint">Your reference number</p><div class="ref">${esc(b.ref)}</div>${badge(b.status)}
      <ul class="plan">${b.visits.map((v) => `<li><b>${v.time}</b><span>${esc(v.service)}<br><small>${esc(v.doctor)} · ${fmtDate(b.date)}</small></span></li>`).join('')}</ul>
      <p><b>Estimated total: ${money(b.total)}</b></p>
      <div id="payBox"></div>
      <p class="hint">Keep your reference number. You can check or cancel this booking any time on the My booking page.</p>
      <div class="actions"><a class="btn" href="booking.html?ref=${encodeURIComponent(b.ref)}">Check booking status</a>
      ${open ? '<button class="btn danger" id="cancelBooking" type="button">Cancel this booking</button>' : ''}
      <button class="btn ghost" id="again" type="button">${cancelled ? 'Make a new booking' : 'Book another visit'}</button></div>`;
    renderPayment($('#payBox'), b, showDone);
    $('#again').onclick = () => location.reload();
    if (open) $('#cancelBooking').onclick = async () => {
      const warning = b.payment.status === 'paid' ? ` Cancelling less than 24 hours before the visit forfeits your deposit.` : '';
      if (!confirm('Cancel this booking?' + warning)) return;
      try { showDone(await api('/api/bookings/cancel', 'POST', { ref: b.ref, phone: state.phone })); }
      catch (err) { toast(err.message, true); }
    };
  }

  go(1);
})();
