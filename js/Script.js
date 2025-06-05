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


document.addEventListener("DOMContentLoaded", () => {
    const onlineTable = document.getElementById("onlinePppoeTable").querySelector("tbody");
    const totalIn = document.getElementById("totalBytesIn");
    const totalOut = document.getElementById("totalBytesOut");
    const showExpiredToggle = document.getElementById("showExpiredToggle");
    const chartCtx = document.getElementById("pppoeChart").getContext("2d");
    let chartInstance = null;
    let users = [];

    async function fetchPPPoeStatus() {
        try {
            const res = await fetch('https://your-domain.com/api/pppoe/status');
            const data = await res.json();
            users = data;
            updateView();
        } catch (error) {
            console.error('Failed to fetch PPPoE data:', error);
        }
    }

    function updateView() {
        const showDisabled = showExpiredToggle.checked;
        const filtered = showDisabled ? users : users.filter(u => !u.disabled);

        renderTable(filtered);
        renderStats(filtered);
        renderChart(filtered);
    }

    function renderTable(users) {
        onlineTable.innerHTML = "";
        users.forEach(user => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${user.username}</td>
                <td>${user.ip || '-'}</td>
                <td>${user.uptime || '-'}</td>
                <td>${formatBytes(user.bytesIn)}</td>
                <td>${formatBytes(user.bytesOut)}</td>
            `;
            onlineTable.appendChild(tr);
        });
    }

    function renderStats(users) {
        const totalBytesIn = users.reduce((sum, u) => sum + u.bytesIn, 0);
        const totalBytesOut = users.reduce((sum, u) => sum + u.bytesOut, 0);
        totalIn.textContent = formatBytes(totalBytesIn);
        totalOut.textContent = formatBytes(totalBytesOut);
    }

    function renderChart(users) {
        const active = users.filter(u => !u.disabled).length;
        const disabled = users.filter(u => u.disabled).length;

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
                plugins: {
                    legend: { position: 'bottom' }
                }
            }
        });
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Event listener for toggle
    showExpiredToggle.addEventListener("change", updateView);

    // Initial fetch
    fetchPPPoeStatus();

    // Optional: Refresh every 60 seconds
    setInterval(fetchPPPoeStatus, 60000);
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
const connectModal = document.getElementById("connectModal");
const connectBtn = document.getElementById("connectBtn");
const connectClose = document.querySelector(".close.connectForm");

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

async function fetchOnlinePppoeUsers() {
    try {
        const response = await fetch('https://isp-billing-uq58.onrender.com/api/pppoe/online');
        const data = await response.json();

        const tableBody = document.querySelector('#onlinePppoeTable tbody');
        tableBody.innerHTML = '';

        if (data.users && data.users.length > 0) {
            data.users.forEach(user => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${user.name || 'N/A'}</td>
                    <td>${user.address || 'N/A'}</td>
                    <td>${user.uptime || 'N/A'}</td>
                    <td>${user['bytes-in'] || '0'}</td>
                    <td>${user['bytes-out'] || '0'}</td>
                `;
                tableBody.appendChild(row);
            });
        } else {
            const row = document.createElement('tr');
            row.innerHTML = `<td colspan="5">No users currently online</td>`;
            tableBody.appendChild(row);
        }

    } catch (error) {
        console.error('Error fetching online PPPoE users:', error);
    }
}

// Call on page load
document.addEventListener('DOMContentLoaded', fetchOnlinePppoeUsers);

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
