/* Helpers shared by every page. */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n).toLocaleString() + ' ETB';
const fmtDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const todayStr = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const badge = (status) => `<span class="badge ${esc(status)}">${esc(String(status).replace('_', ' '))}</span>`;
const methodName = (id) => ({ telebirr: 'Telebirr', cbe: 'CBE', abyssinia: 'Abyssinia Bank' }[id] || id);
const clock = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const shortName = (n) => n.replace('Dr. ', '');

// Calls the API and returns JSON. Throws an Error with a readable message on failure.
async function api(url, method = 'GET', body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Something went wrong.'); e.status = res.status; throw e; }
  return data;
}

function toast(message, bad = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.setAttribute('role', 'status');
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// Vertical bar chart: data = [{label, value}]
function barChart(el, data) {
  const max = Math.max(1, ...data.map((d) => d.value));
  el.className = 'chart';
  el.innerHTML = data.map((d) => `<div class="bar"><span class="bar-val">${d.value}</span>
    <div class="bar-track"><div class="bar-fill" style="height:${Math.round((d.value / max) * 100)}%"></div></div>
    <span class="bar-label">${esc(d.label)}</span></div>`).join('');
}
// Horizontal bar chart for longer labels.
function hbarChart(el, data) {
  const max = Math.max(1, ...data.map((d) => d.value));
  el.innerHTML = data.map((d) => `<div class="hbar"><span title="${esc(d.label)}">${esc(d.label)}</span>
    <i style="width:${Math.max(4, Math.round((d.value / max) * 100))}%"></i><span>${d.value}</span></div>`).join('');
}

// Light and dark mode, remembered in the browser.
function initTheme(button) {
  const apply = (t) => { document.documentElement.dataset.theme = t; button.textContent = t === 'dark' ? 'Light mode' : 'Dark mode'; };
  let theme = 'light';
  try { theme = localStorage.getItem('theme') || 'light'; } catch (e) { /* storage blocked */ }
  apply(theme);
  button.onclick = () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    apply(theme);
    try { localStorage.setItem('theme', theme); } catch (e) { /* ignore */ }
  };
}

// Patient record: past visits with diagnosis, treatment and medicines.
function historyHTML(rows) {
  if (!rows.length) return '<p class="empty">No completed visits yet.</p>';
  return rows.map((h) => `<div class="rec"><h4>${fmtDate(h.date)} · ${esc(h.service)} · ${esc(h.doctor)}</h4>
    <p><b>Diagnosis:</b> ${esc(h.diagnosis)}</p>${h.treatment ? `<p><b>Treatment:</b> ${esc(h.treatment)}</p>` : ''}
    ${h.medicines ? `<p><b>Medicines:</b> ${esc(h.medicines)}</p>` : ''}${h.doctor_notes ? `<p><b>Notes:</b> ${esc(h.doctor_notes)}</p>` : ''}</div>`).join('');
}

async function signOut() { await api('/api/auth/logout', 'POST'); location.href = '/staff-login'; }

// For staff pages. 401 = not signed in. 403 = this browser is signed in as a different role
// (a browser keeps one login, so signing in as a doctor in another tab replaces the reception login).
async function authApi(...args) {
  try { return await api(...args); } catch (e) {
    if (e.status === 401) location.replace('/staff-login');
    if (e.status === 403) {
      toast('This browser is now signed in as a different account. Please sign in again.', true);
      setTimeout(() => location.replace('/staff-login?switched=1'), 1800);
    }
    throw e;
  }
}

// A unique key for each form, so a double click or a retry never saves the same payment twice.
const uuid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const stamp = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
