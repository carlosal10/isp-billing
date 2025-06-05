// Login logic
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    try {
        const response = await fetch('https://isp-billing-uq58.onrender.com/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });

        const data = await response.json();

        if (data.success) {
            window.location.href = 'dashboard.html';
        } else {
            document.getElementById('errorMessage').textContent = data.message;
        }
    } catch (err) {
        console.error(err);
        document.getElementById('errorMessage').textContent = 'Error connecting to server.';
    }
});

// ========== Modal Logic ==========

// PPPoE Modal
const pppoeModal = document.getElementById("pppoeModal");
const pppoeBtn = document.getElementById("pppoeBtn");
const pppoeClose = document.querySelector(".close.pppoe");

pppoeBtn?.addEventListener("click", () => {
    pppoeModal.style.display = "block";
});
pppoeClose?.addEventListener("click", () => {
    pppoeModal.style.display = "none";
});

// Plan Modal
const planModal = document.getElementById("addPlanModal");
const planBtn = document.getElementById("planBtn");
const planClose = document.getElementById("closePlanForm");

planBtn?.addEventListener("click", () => {
    planModal.style.display = "block";
});
planClose?.addEventListener("click", () => {
    planModal.style.display = "none";
});

// Plan Modal
const customerModal = document.getElementById("addCustomerModal");
const customerBtn = document.getElementById("customerBtn");
const customerClose = document.getElementById("closeCustomerForm");

customerBtn?.addEventListener("click", () => {
    customerModal.style.display = "block";
});
customerClose?.addEventListener("click", () => {
    customerModal.style.display = "none";
});

// PPPoE Modal
const pppoeModal = document.getElementById("connectModal");
const pppoeBtn = document.getElementById("connectBtn");
const pppoeClose = document.querySelector(".close.connectForm");

connectBtn?.addEventListener("click", () => {
    connectModal.style.display = "block";
});
connectClose?.addEventListener("click", () => {
    connectModal.style.display = "none";
});


// Window click to close any modal
window.addEventListener("click", (e) => {
    if (e.target === pppoeModal) pppoeModal.style.display = "none";
    if (e.target === planModal) planModal.style.display = "none";
    if (e.target === customerModal) customerModal.style.display = "none";
    if (e.target === connectModal) connectModal.style.display = "none";
});


document.getElementById('connectForm').onsubmit = async function(e) {
      e.preventDefault();

      const formData = {
        ip: document.getElementById('ip').value,
        username: document.getElementById('username').value,
        password: document.getElementById('password').value
      };

      const responseDiv = document.getElementById('response');

      try {
        const res = await fetch('https://isp-billing-uq58.onrender.com/api/connect', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(formData)
        });

        const data = await res.json();
        responseDiv.textContent = data.message || 'Connected successfully!';
      } catch (err) {
        responseDiv.textContent = 'Failed to connect to MikroTik.';
      }
    };
// ========== PPPoE User Logic ==========

// Add User
document.getElementById("addUserForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("pppoeUsername").value;
    const password = document.getElementById("pppoePassword").value;
    const profile = document.getElementById("profile").value;

    const res = await fetch('https://isp-billing-uq58.onrender.com/api/pppoe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, profile })
    });

    alert((await res.json()).message);
});

// Update User
document.getElementById("updateUserForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("updateUsername").value;
    const password = document.getElementById("newPassword").value;

    const res = await fetch(`https://isp-billing-uq58.onrender.com/api/pppoe/update/${username}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    });

    alert((await res.json()).message);
});

// Remove User
document.getElementById("removeUserForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("removeUsername").value;

    const res = await fetch(`https://isp-billing-uq58.onrender.com/api/pppoe/remove/${username}`, {
        method: 'DELETE'
    });

    alert((await res.json()).message);
});

// ========== Dashboard Stats ==========

async function loadStats() {
    try {
        const response = await fetch('https://isp-billing-uq58.onrender.com/api/stats');
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const stats = await response.json();
        document.getElementById('totalCustomers').textContent = stats.totalCustomers || 0;
        document.getElementById('activePlans').textContent = stats.activePlans || 0;
        document.getElementById('pendingInvoices').textContent = stats.pendingInvoices || 0;
    } catch (err) {
        console.error('Failed to fetch stats:', err);
    }
}

if (document.getElementById('totalCustomers')) {
    loadStats();
}
