  const mpesaSettingsModal = document.getElementById('mpesa-settings-modal');
  const mpesaSettingsForm = document.getElementById('mpesa-settings-form');

  // Sidebar button trigger
  document.getElementById('mpesa-settings-btn').addEventListener('click', () => {
    mpesaSettingsModal.style.display = 'block';
  });

  function closeMpesaModal() {
    mpesaSettingsModal.style.display = 'none';
  }

  mpesaSettingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = {
      businessName: mpesaSettingsForm.businessName.value.trim(),
      paybillShortcode: mpesaSettingsForm.paybillShortcode.value.trim(),
      paybillPasskey: mpesaSettingsForm.paybillPasskey.value.trim(),
      buyGoodsTill: mpesaSettingsForm.buyGoodsTill.value.trim(),
      buyGoodsPasskey: mpesaSettingsForm.buyGoodsPasskey.value.trim(),
    };

    try {
      const res = await fetch('/api/mpesa/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await res.json();
      if (result.success) {
        alert('M-Pesa settings saved successfully!');
        closeMpesaModal();
      } else {
        alert('Failed to save settings: ' + result.message);
      }
    } catch (err) {
      console.error('Error saving M-Pesa settings:', err);
      alert('An error occurred while saving settings.');
    }
  });

  // Close modal on outside click
  window.onclick = function (event) {
    if (event.target == mpesaSettingsModal) {
      mpesaSettingsModal.style.display = 'none';
    }
  };
