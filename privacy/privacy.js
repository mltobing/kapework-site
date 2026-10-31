/* Uses the same feedback form and submission service as Kapework apps. */
window.KapeworkShell?.init({ appSlug: 'privacy', mountId: 'privacy-menu' });
document.getElementById('privacy-contact').addEventListener('click', () => {
  window.KapeworkShell?.openFeedback();
});
