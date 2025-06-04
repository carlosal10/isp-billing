// script.js

document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    // Modal logic
    const modal = document.getElementById("pppoeModal");
    const btn = document.getElementById("pppoeBtn");
    const span = document.querySelector(".close");

    btn.onclick = () => modal.style.display = "block";
    span.onclick = () => modal.style.display = "none";
    window.onclick = (e) => {
    if (e.target === modal) modal.style.display = "none";
    };

    // Add User
    document.getElementById("addUserForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    const profile = document.getElementById("profile").value;

    const res = await fetch('/api/pppoe/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, profile })
    });

    alert((await res.json()).message);
    });

    // Update User
    document.getElementById("updateUserForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("updateUsername").value;
    const password = document.getElementById("newPassword").value;

    const res = await fetch(`/api/pppoe/update/${username}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    });

    alert((await res.json()).message);
});

// Remove User
document.getElementById("removeUserForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("removeUsername").value;

    const res = await fetch(`/api/pppoe/remove/${username}`, {
        method: 'DELETE'
    });

    alert((await res.json()).message);
});


    try {
        const response = await fetch('https://isp-billing-uq58.onrender.com/api/admin/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
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

// Dashboard stats script
async function loadStats() {
    try {
        const response = await fetch('https://isp-billing-uq58.onrender.com/api/stats');
        
        // Check for response success
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const stats = await response.json();

        // Update the stats on the dashboard
        document.getElementById('totalCustomers').textContent = stats.totalCustomers || 0;
        document.getElementById('activePlans').textContent = stats.activePlans || 0;
        document.getElementById('pendingInvoices').textContent = stats.pendingInvoices || 0;
    } catch (err) {
        console.error('Failed to fetch stats:', err);
    }
}

// Call `loadStats` when the dashboard page loads
if (document.getElementById('totalCustomers')) {
    loadStats();
}
