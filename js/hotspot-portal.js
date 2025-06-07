const plansList = document.getElementById('plansList');
const checkoutModal = document.getElementById('checkoutModal');
const selectedPlanDetails = document.getElementById('selectedPlanDetails');
const phoneInput = document.getElementById('customerPhone');

let selectedPlan = null;

// Fetch available hotspot plans from backend
async function loadHotspotPlans() {
  try {
    const res = await fetch('https://isp-billing-uq58.onrender.com/api/hotspot/plans');
    const plans = await res.json();

    if (!Array.isArray(plans)) throw new Error('Invalid plan format');

    plans.forEach(plan => {
      const card = document.createElement('div');
      card.className = 'plan-card';
      card.innerHTML = `
        <h3>${plan.name}</h3>
        <p><strong>Speed:</strong> ${plan.speed || 'Unlimited'}</p>
        <p><strong>Price:</strong> ₹${plan.price}</p>
        <p><strong>Validity:</strong> ${plan.validity} day(s)</p>
        <button onclick='selectPlan(${JSON.stringify(plan)})'>Connect</button>
      `;
      plansList.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to load plans:', err);
    plansList.innerHTML = `<p>Could not load plans. Please try again later.</p>`;
  }
}

// Triggered when user clicks "Connect"
function selectPlan(plan) {
  selectedPlan = plan;
  selectedPlanDetails.innerHTML = `
    <p><strong>Plan:</strong> ${plan.name}</p>
    <p><strong>Speed:</strong> ${plan.speed}</p>
    <p><strong>Price:</strong> ₹${plan.price}</p>
    <p><strong>Validity:</strong> ${plan.validity} day(s)</p>
  `;
  phoneInput.value = '';
  checkoutModal.classList.remove('hidden');
}

// Close the modal
function closeModal() {
  checkoutModal.classList.add('hidden');
  selectedPlan = null;
}

// On "Pay & Connect" click
async function payAndConnect() {
  const phone = phoneInput.value.trim();
  if (!phone) {
    alert('Please enter your phone number');
    return;
  }

  try {
    // Simulate fetching MAC address from backend (captured from login page)
    const macRes = await fetch('https://isp-billing-uq58.onrender.com/api/hotspot/mac');
    const macData = await macRes.json();
    const macAddress = macData.mac;

    if (!macAddress) throw new Error('MAC address not found');

    const payload = {
      planId: selectedPlan._id,
      phone,
      mac: macAddress,
    };

    const res = await fetch('https://isp-billing-uq58.onrender.com/api/hotspot/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();

    if (res.ok) {
      alert(`Connected successfully!\nUsername: ${result.username}`);
      window.location.href = result.loginURL || '/login'; // Optional auto-redirect
    } else {
      alert(result.message || 'Failed to connect');
    }

  } catch (err) {
    console.error('Connection failed:', err);
    alert('Something went wrong. Try again.');
  } finally {
    closeModal();
  }
}

// Initialize
loadHotspotPlans();
