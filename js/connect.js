document.getElementById('connectForm').addEventListener('submit', async function (e) {
      e.preventDefault();

      const formData = {
        ip: document.getElementById('ip').value,
        username: document.getElementById('username').value,
        password: document.getElementById('password').value
      };

      const resBox = document.getElementById('response');
      resBox.textContent = 'Connecting...';

      try {
        const res = await fetch('https://isp-billing-uq58.onrender.com/api/connect', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(formData)
        });

        const data = await res.json();
        if (data.success) {
          resBox.textContent = data.message;
        } else {
          resBox.textContent = data.message || 'Connection failed';
        }
      } catch (error) {
        resBox.textContent = 'Network error or server unreachable.';
      }
    });
