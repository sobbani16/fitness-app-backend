'use strict';
const params = new URLSearchParams(location.hash.slice(1));
const token = params.get('token');
const purpose = params.get('purpose');
// Remove the secret from the address bar/history immediately. Never send it on GET.
history.replaceState(null, '', location.pathname);
const el = id => document.getElementById(id);
const valid = ['reset-password', 'verify-email'].includes(purpose) && /^[A-Za-z0-9_-]{43}$/.test(token || '');
if (valid) {
  const reset = purpose === 'reset-password';
  el('title').textContent = reset ? 'Reset your password' : 'Verify your email';
  el('intro').textContent = reset ? 'Choose a new password for your Fitness account.' : 'Confirm that this is your email address.';
  el('action').hidden = false;
  el('password-fields').hidden = !reset;
  el('password').required = reset;
  el('confirm').required = reset;
  el('submit').textContent = reset ? 'Update password' : 'Verify email';
  el('purpose').value = reset ? 'forgot-password' : 'resend-verification';
} else {
  el('message').textContent = 'This link is incomplete. Open the full email link or request a new one below.';
  document.querySelector('details').open = true;
}
function showState(state) {
  el('action').hidden = true;
  el('intro').hidden = true;
  if (state === 'consumed' && purpose === 'verify-email') {
    el('message').textContent = 'This email is already verified.';
    el('done').hidden = false;
    return;
  }
  el('message').textContent = state === 'consumed'
    ? 'This link was already used. Request a new one below.'
    : state === 'expired'
      ? 'This link has expired. Request a new one below.'
      : 'This link is invalid. Request a new one below.';
  document.querySelector('details').open = true;
}
async function post(path, body) {
  const response = await fetch(`/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Unable to continue. Please try again later.');
  return data;
}
if (valid) {
  // A used or expired link renders its real state instead of a button that only fails on click.
  post('action-status', { purpose, token }).then(({ state }) => { if (state && state !== 'ready') showState(state); }).catch(() => {});
}
el('action').addEventListener('submit', async event => {
  event.preventDefault();
  if (el('submit').disabled || !valid) return;
  if (purpose === 'reset-password' && el('password').value !== el('confirm').value) { el('message').textContent = 'Passwords do not match.'; return; }
  el('submit').disabled = true; el('message').textContent = '';
  try {
    const data = await post(purpose, { token, ...(purpose === 'reset-password' ? { password: el('password').value } : {}) });
    el('message').textContent = data.message; el('action').hidden = true; el('intro').hidden = true; el('done').hidden = false;
    el('password').value = ''; el('confirm').value = '';
  } catch (error) {
    if (/invalid or expired/i.test(error.message)) {
      // Re-check so the message is accurate: consumed, expired or invalid.
      const { state } = await post('action-status', { purpose, token }).catch(() => ({ state: 'invalid' }));
      showState(state === 'ready' ? 'invalid' : state);
      return;
    }
    el('message').textContent = error.name === 'TimeoutError' ? 'The request timed out. Try again or request a new link.' : error.message;
  }
  finally { el('submit').disabled = false; }
});
el('request').addEventListener('submit', async event => {
  event.preventDefault();
  if (el('resend').disabled) return;
  el('resend').disabled = true;
  try { el('request-message').textContent = (await post(el('purpose').value, { email: el('email').value })).message; }
  catch (error) { el('request-message').textContent = error.message; }
  finally { el('resend').disabled = false; }
});
