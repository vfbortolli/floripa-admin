import('/floripa-admin/app/app.js')
  .then(() => { console.log('✓ app.js loaded successfully'); process.exit(0); })
  .catch(err => { console.error('✗ Error loading app.js:', err.message); process.exit(1); });
