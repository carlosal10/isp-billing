document.getElementById('connectForm').onsubmit = async function(e) {
    e.preventDefault();

    const formData = {
      ip: document.getElementById('ip').value.trim(),
      username: document.getElementById('username').value.trim(),
      password: document.getElementById('password').value
    };

    const responseDiv = document.getElementById('response');
    responseDiv.style.color = '#333';
    responseDiv.textContent = 'Connecting...';

    try {
      const res = await fetch('https://isp-billing-uq58.onrender.com/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.message);

      responseDiv.style.color = 'green';
      responseDiv.textContent = data.message || 'Connected successfully!';
    } catch (err) {
      responseDiv.style.color = 'red';
      responseDiv.textContent = err.message || 'Failed to connect to MikroTik.';
    }
  };


