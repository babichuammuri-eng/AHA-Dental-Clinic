/* Deposit panel, shared by the booking confirmation and the "My booking" page.
   Shows what the patient must do next, depending on the payment status. */
let paymentInfo = null;

async function renderPayment(box, booking, onChange) {
  paymentInfo = paymentInfo || await api('/api/payment-info');
  const p = booking.payment, amount = money(p.deposit);

  if (booking.status === 'pending' && ['unpaid', 'rejected'].includes(p.status)) {
    const left = Math.max(0, Math.round((new Date(p.expires_at) - Date.now()) / 60000));
    box.innerHTML = `<div class="paybox"><h3>Pay a deposit of ${amount} to hold your slot</h3>
      <p>${p.status === 'rejected' ? '<b class="err">We could not verify your payment. Check the transaction ID and try again.</b><br>' : ''}
      Your slot is held until <b>${clock(p.expires_at)}</b> (${left} minutes). After that it is released.
      The deposit is deducted from your bill, and refunded if you cancel at least ${paymentInfo.refundHours} hours before.</p>
      <div class="methods">${paymentInfo.methods.map((m) => `<label class="check"><input type="radio" name="pm" value="${esc(m.id)}"><span>${esc(m.name)}</span></label>`).join('')}</div>
      <div class="how" id="how" hidden></div>
      <label for="txn">Transaction ID (from your payment message)</label><input id="txn" autocomplete="off" placeholder="e.g. TB48213907">
      <button class="btn block" id="payBtn" type="button" style="margin-top:.8rem">I have paid</button>
      <p class="err" id="payMsg" role="alert"></p></div>`;
    $$('input[name=pm]', box).forEach((r) => r.addEventListener('change', () => {
      const m = paymentInfo.methods.find((x) => x.id === r.value);
      $('#how', box).hidden = false;
      $('#how', box).innerHTML = `Send <b>${amount}</b> to<br><b>${esc(m.account)}</b> (${esc(m.holder)})<br><span class="hint">${esc(m.how)}</span>`;
    }));
    $('#payBtn', box).onclick = async () => {
      const method = ($('input[name=pm]:checked', box) || {}).value;
      try {
        onChange(await api('/api/bookings/payment', 'POST', { ref: booking.ref, method, transaction_ref: $('#txn', box).value }));
      } catch (err) { $('#payMsg', box).textContent = err.message; }
    };
    return;
  }

  const notes = {
    submitted: ['', `Payment of ${amount} submitted (${esc(methodName(p.method))}, ${esc(p.ref)}). Reception is checking it and will confirm your booking shortly.`],
    paid: ['', booking.money ? `Payment verified. Received so far: ${money(booking.money.netPaid)}. Remaining balance: ${money(booking.money.balance)}.` : `Deposit of ${amount} received. It will be deducted from your bill.`],
    refund_due: ['', `You cancelled in time. Your payment of ${booking.money ? money(booking.money.refundOwed) : amount} will be refunded.`],
    refunded: ['', `Your deposit of ${amount} has been refunded.`],
    forfeited: ['warn', `Deposit of ${amount} is not refundable (cancelled less than ${paymentInfo.refundHours} hours before, or missed visit).`],
    expired: ['warn', 'This booking expired because the deposit did not arrive in time. You can make a new booking.']
  }[p.status];
  box.innerHTML = notes ? `<div class="paynote ${notes[0]}">${notes[1]}</div>` : '';
}
