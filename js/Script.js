// ====== Central API base URL ======
const baseApi = 'https://isp-billing-uq58.onrender.com/api';
// ====== Utility: Format bytes ======
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

// ====== Modal Binding Helper ======
function bindModal(buttonId, modalId, closeSelector) {
  const btn = document.getElementById(buttonId);
  const modal = document.getElementById(modalId);
  const close = document.querySelector(closeSelector);

  btn?.addEventListener("click", () => modal.style.display = "block");
  close?.addEventListener("click", () => modal.style.display = "none");
  window.addEventListener("click", (e) => {
    if (e.target === modal) modal.style.display = "none";
  });
}

// ====== Auth: Login Handler ======
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const response = await fetch(`${baseApi}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json();
    if (data.success) window.location.href = 'dashboard.html';
    else document.getElementById('errorMessage').textContent = data.message || 'Login failed.';
  } catch (err) {
    console.error(err);
    document.getElementById('errorMessage').textContent = 'Error connecting to server.';
  }
});

// ====== Dashboard Stats Loader ======
async function loadStats() {
  try {
    const res = await fetch(`${baseApi}/stats`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const stats = await res.json();
    document.getElementById('totalCustomers').textContent = stats.totalCustomers || 0;
    document.getElementById('activePlans').textContent = stats.activePlans || 0;
    document.getElementById('pendingInvoices').textContent = stats.pendingInvoices || 0;
  } catch (err) {
    console.error('Failed to fetch stats:', err);
  }
}
if (document.getElementById('totalCustomers')) loadStats();

// ====== PPPoE User Management ======
document.getElementById("addUserForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("pppoeUsername").value.trim();
  const password = document.getElementById("pppoePassword").value;
  const profile = document.getElementById("profile").value;

  try {
    const res = await fetch(`${baseApi}/pppoe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, profile })
    });
    const data = await res.json();
    alert(data.message);
  } catch (err) {
    console.error(err);
    alert('Failed to add user.');
  }
});

document.getElementById("updateUserForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("updateUsername").value.trim();
  const password = document.getElementById("newPassword").value;

  try {
    const res = await fetch(`${baseApi}/pppoe/update/${encodeURIComponent(username)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    alert(data.message);
  } catch (err) {
    console.error(err);
    alert('Failed to update user.');
  }
});

document.getElementById("removeUserForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("removeUsername").value.trim();

  try {
    const res = await fetch(`${baseApi}/pppoe/remove/${encodeURIComponent(username)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    alert(data.message);
  } catch (err) {
    console.error(err);
    alert('Failed to remove user.');
  }
});

// ====== PPPoE Online Users + Stats + Chart ======
document.addEventListener("DOMContentLoaded", () => {
  const tableBody = document.querySelector('#onlinePppoeTable tbody');
  const totalIn = document.getElementById("totalBytesIn");
  const totalOut = document.getElementById("totalBytesOut");
  const toggle = document.getElementById("showExpiredToggle");
  const chartCtx = document.getElementById("pppoeChart")?.getContext("2d");
  let chartInstance = null;
  let users = [];

  async function fetchPPPoeStatus() {
    try {
      const res = await fetch(`${baseApi}/pppoe/status`);
      users = await res.json();
      updateView();
    } catch (err) {
      console.error('Fetch error:', err);
    }
  }

  function updateView() {
    const filtered = toggle?.checked ? users : users.filter(u => !u.disabled);
    renderTable(filtered);
    renderStats(filtered);
    renderChart(filtered);
  }

  function renderTable(users) {
    if (!tableBody) return;
    tableBody.innerHTML = '';
    if (users.length === 0) {
      const row = document.createElement('tr');
      row.innerHTML = `<td colspan="5" style="text-align:center;">No users found</td>`;
      tableBody.appendChild(row);
      return;
    }
    users.forEach(user => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${user.username || '-'}</td>
        <td>${user.ip || '-'}</td>
        <td>${user.uptime || '-'}</td>
        <td>${formatBytes(user.bytesIn)}</td>
        <td>${formatBytes(user.bytesOut)}</td>
      `;
      tableBody.appendChild(row);
    });
  }

  function renderStats(users) {
    if (!totalIn || !totalOut) return;
    const inSum = users.reduce((sum, u) => sum + (u.bytesIn || 0), 0);
    const outSum = users.reduce((sum, u) => sum + (u.bytesOut || 0), 0);
    totalIn.textContent = formatBytes(inSum);
    totalOut.textContent = formatBytes(outSum);
  }

  function renderChart(users) {
    if (!chartCtx) return;
    const active = users.filter(u => !u.disabled).length;
    const disabled = users.length - active;

    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(chartCtx, {
      type: 'doughnut',
      data: {
        labels: ['Active', 'Disabled'],
        datasets: [{
          data: [active, disabled],
          backgroundColor: ['#28a745', '#dc3545']
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } }
      }
    });
  }

  toggle?.addEventListener('change', updateView);

  fetchPPPoeStatus();
  setInterval(fetchPPPoeStatus, 60000);
});

// ====== Modal Bindings ======
bindModal("pppoeBtn", "pppoeModal", ".close.pppoe");
bindModal("planBtn", "addPlanModal", "#closePlanForm");
bindModal("customerBtn", "addCustomerModal", "#closeCustomerForm");
bindModal("connectBtn", "connectModal", ".close.connectForm");

// ====== Fetch and Render Online PPPoE Users Table (alternative) ======
async function fetchOnlinePppoeUsers() {
  try {
    const res = await fetch(`${baseApi}/pppoe/online`);
    const { users = [] } = await res.json();
    const tbody = document.querySelector('#onlinePppoeTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (users.length === 0) {
      const row = document.createElement('tr');
      row.innerHTML = `<td colspan="5" style="text-align:center;">No users currently online</td>`;
      tbody.appendChild(row);
      return;
    }

    users.forEach(user => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${user.name || 'N/A'}</td>
        <td>${user.address || 'N/A'}</td>
        <td>${user.uptime || 'N/A'}</td>
        <td>${formatBytes(user['bytes-in'])}</td>
        <td>${formatBytes(user['bytes-out'])}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error fetching online PPPoE users:', err);
  }
}

document.addEventListener('DOMContentLoaded', fetchOnlinePppoeUsers);
