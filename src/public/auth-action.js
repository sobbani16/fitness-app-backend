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
}
async function post(path, body) {
  const response = await fetch(`/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Unable to continue. Please try again later.');
  return data;
}
el('action').addEventListener('submit', async event => {
  event.preventDefault();
  if (el('submit').disabled || !valid) return;
  if (purpose === 'reset-password' && el('password').value !== el('confirm').value) { el('message').textContent = 'Passwords do not match.'; return; }
  el('submit').disabled = true; el('message').textContent = '';
  try {
    const data = await post(purpose, { token, ...(purpose === 'reset-password' ? { password: el('password').value } : {}) });
    el('message').textContent = data.message; el('action').hidden = true; el('done').hidden = false;
    el('password').value = ''; el('confirm').value = '';
  } catch (error) { el('message').textContent = error.name === 'TimeoutError' ? 'The request timed out. Try again or request a new link.' : error.message; }
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
