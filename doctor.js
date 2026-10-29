/* Doctor portal: today's queue, upcoming visits, patients and medical records. */
(async function () {
  const { user } = await api('/api/auth/me');
  if (!user || user.role !== 'doctor') return location.replace('/staff-login');
  initTheme($('#theme'));
  $('#logout').onclick = signOut;
  const call = authApi;

  const me = await call('/api/doctor/me');
  $('#who').innerHTML = `${esc(me.name)} <small>${esc(me.specialty)}</small>`;
  const hour = new Date().getHours();
  $('#hello').textContent = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, ${shortName(me.name).split(' ')[0]}`;
  let tab = 'today', current = null;

  async function loadStats() {
    const s = await call('/api/doctor/stats');
    $('#stats').innerHTML = [['Patients today', s.today], ['Done today', s.doneToday], ['Upcoming', s.upcoming], ['My patients', s.patients]]
      .map(([label, value]) => `<div class="stat glass"><b>${value}</b><span>${label}</span></div>`).join('');
    barChart($('#chartDay'), s.perDay);
  }

  function visitCard(v) {
    const done = v.status === 'completed';
    return `<article class="item-card glass visit ${done ? 'done-visit' : ''}">
      <div><div class="time">${v.time}</div><div class="meta">${fmtDate(v.date)}</div>${done ? badge('completed') : ''}</div>
      <div><h3>${esc(v.patient)} ${v.past_visits ? `<span class="tag">Returning · ${v.past_visits} past</span>` : '<span class="tag">New patient</span>'}</h3>
        <div class="meta">${esc(v.service)} · <a href="tel:${esc(v.phone)}">${esc(v.phone)}</a></div>
        ${v.allergies ? `<div class="err" style="font-size:.88rem">Allergies: ${esc(v.allergies)}</div>` : ''}
        ${v.last_diagnosis ? `<div class="meta">Last visit: ${esc(v.last_diagnosis)}${v.last_medicines ? ' · ' + esc(v.last_medicines) : ''}</div>` : ''}
        ${v.notes ? `<div class="meta">Patient note: ${esc(v.notes)}</div>` : ''}</div>
      <div class="actions"><button class="btn ghost sm" data-act="history" data-patient="${v.patient_id}">History</button>
        ${done ? '' : `<button class="btn sm" data-act="complete" data-id="${v.id}" data-name="${esc(v.patient)}" data-service="${esc(v.service)}">Complete visit</button>`}</div></article>`;
  }

  async function loadList() {
    if (tab === 'patients') {
      const rows = await call('/api/doctor/patients');
      $('#list').innerHTML = rows.length ? rows.map((p) => `<article class="item-card glass">
        <div><h3>${esc(p.name)}</h3><div class="meta"><a href="tel:${esc(p.phone)}">${esc(p.phone)}</a></div></div>
        <div class="meta">${p.visits} visit${p.visits === 1 ? '' : 's'} with you · last ${fmtDate(p.last_visit)}
          ${p.allergies ? `<div class="err">Allergies: ${esc(p.allergies)}</div>` : ''}</div>
        <div class="actions"><button class="btn ghost sm" data-act="history" data-patient="${p.id}">History</button></div></article>`).join('')
        : '<p class="empty">No patients yet.</p>';
      return;
    }
    const rows = await call('/api/doctor/visits?scope=' + tab);
    $('#list').innerHTML = rows.length ? rows.map(visitCard).join('')
      : `<p class="empty">${tab === 'today' ? 'No confirmed patients for today yet.' : 'No upcoming visits.'}</p>`;
  }
  const refresh = () => Promise.all([loadStats(), loadList()]).catch(() => {});

  // ----- Patient record, with editable allergies -----
  async function openHistory(patientId) {
    const h = await call(`/api/doctor/patients/${patientId}/history`);
    $('#histBody').innerHTML = `<h2>${esc(h.patient.name)}</h2><p class="hint">${esc(h.patient.phone)}</p>
      <label for="allergies">Allergies and medical alerts</label>
      <div style="display:flex;gap:.5rem"><input id="allergies" value="${esc(h.patient.allergies)}" placeholder="None recorded">
      <button class="btn sm" id="saveAllergies" type="button">Save</button></div>${historyHTML(h.history)}`;
    $('#saveAllergies').onclick = async () => {
      try { await call(`/api/doctor/patients/${patientId}`, 'PATCH', { allergies: $('#allergies').value }); toast('Saved'); refresh(); }
      catch (err) { toast(err.message, true); }
    };
    $('#histDlg').showModal();
  }
  $('#histClose').onclick = () => $('#histDlg').close();

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    try {
      if (b.dataset.act === 'history') await openHistory(b.dataset.patient);
      if (b.dataset.act === 'complete') {
        current = b.dataset.id;
        $('#doneForm').reset(); $('#dErr').textContent = '';
        $('#doneSub').textContent = `${b.dataset.name} · ${b.dataset.service}`;
        $('#doneDlg').showModal();
      }
    } catch (err) { toast(err.message, true); }
  });
  $('#dCancel').onclick = () => $('#doneDlg').close();
  $('#doneForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await call(`/api/doctor/visits/${current}/complete`, 'PATCH', { diagnosis: $('#dDiag').value, treatment: $('#dTreat').value, medicines: $('#dMeds').value, notes: $('#dNotes').value });
      $('#doneDlg').close(); toast('Saved to the patient record'); refresh();
    } catch (err) { $('#dErr').textContent = err.message; }
  });

  $$('.tabs button').forEach((t) => t.addEventListener('click', () => {
    tab = t.dataset.tab;
    $$('.tabs button').forEach((x) => x.setAttribute('aria-selected', x === t));
    loadList();
  }));

  refresh();
  // New confirmed patients show up automatically every 30 seconds.
  setInterval(() => { if (!document.querySelector('dialog[open]')) refresh(); }, 30000);
})();
