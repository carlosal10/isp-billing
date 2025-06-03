// script.js

document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        const response = await fetch('http://localhost:5000/api/admin/login', {
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
        const response = await fetch('http://localhost:5000/api/stats');
        
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
