/* Staff sign in: reception goes to the reception dashboard, doctors to their portal. */
(function () {
  const params = new URLSearchParams(location.search);
  if (params.has('switched')) $('#msg').textContent = 'You were signed in as a different user. Please sign in again.';

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#msg').textContent = '';
    try {
      const r = await api('/api/auth/login', 'POST', { username: $('#u').value, password: $('#p').value });
      // Go back to the page the staff member asked for, if it is a staff page. The server still checks the role.
      const next = params.get('next');
      location.replace(next && /^\/staff\/[\w\/-]*$/.test(next) ? next : r.next);
    } catch (err) { $('#msg').textContent = err.message; $('#p').value = ''; }
  });
})();
