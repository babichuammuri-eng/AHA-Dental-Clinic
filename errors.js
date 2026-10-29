// Throw this from any route to send a clear message to the browser.
const bad = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
module.exports = { bad };
