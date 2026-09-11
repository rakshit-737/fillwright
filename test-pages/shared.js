// Test pages never send anything anywhere. Submitting only records the fact
// locally, so the end-to-end run can assert that Fillwright never submits.
window.__submitted = false;

document.querySelectorAll('form').forEach((form) => {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    window.__submitted = true;
    console.log('[test-page] submit pressed by the user — nothing was sent');
  });
});
