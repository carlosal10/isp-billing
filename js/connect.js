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