import { finishSignIn } from '../auth.js';

// Remove response parameters before network requests or navigation. This page
// deliberately has no analytics, feedback widget, third-party images or scripts.
const parameters = new URLSearchParams(location.search);
const input = { code: parameters.get('code'), error: parameters.get('error') };
history.replaceState(null, '', location.pathname);
const result = await finishSignIn(input);
if (result.ok) location.replace(result.path);
else {
  document.querySelector('#heading').textContent = 'Let’s try signing in again';
  document.querySelector('#message').textContent = result.message;
  const back = document.querySelector('#return'); back.href = result.path; back.hidden = false;
}
