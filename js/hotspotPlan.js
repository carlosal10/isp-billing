const hotspotApiUrl = 'https://isp-billing-uq58.onrender.com/api/hotspot-plans';

  document.addEventListener('DOMContentLoaded', () => {
    loadHotspotConfigs();
    loadHotspotPlans();

    const form = document.getElementById('hotspotPlanForm');
    let editingId = null;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const plan = {
        name: document.getElementById('plan-Name').value.trim(),
        price: parseFloat(document.getElementById('plan-Price').value.trim()),
        duration: document.getElementById('plan-Duration').value.trim(),
        speed: document.getElementById('planSpeed').value.trim(),
        mikrotikServer: document.getElementById('mikrotikServer').value,
        mikrotikProfile: document.getElementById('mikrotikProfile').value,
        sharedSecret: document.getElementById('sharedSecret').value.trim()
      };

      try {
        const response = await fetch(editingId ? `${hotspotApiUrl}/${editingId}` : hotspotApiUrl, {
          method: editingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(plan)
        });

        if (!response.ok) throw new Error('Failed to save plan');
        
        alert('Hotspot plan saved successfully!');
        form.reset();
        editingId = null;
        loadHotspotPlans();
      } catch (err) {
        console.error(err);
        alert('Error saving plan');
      }
    });
  });

  // Load MikroTik hotspot configs
  async function loadHotspotConfigs() {
    try {
      const response = await fetch('https://isp-billing-uq58.onrender.com/api/mikrotik/hotspot-configs');
      const { servers, profiles } = await response.json();

      const serverSelect = document.getElementById('mikrotikServer');
      const profileSelect = document.getElementById('mikrotikProfile');

      serverSelect.innerHTML = '<option value="">Select Hotspot Server</option>';
      profileSelect.innerHTML = '<option value="">Select Hotspot Profile</option>';

      servers.forEach(server => {
        const option = document.createElement('option');
        option.value = server.name;
        option.textContent = server.name;
        serverSelect.appendChild(option);
      });

      profiles.forEach(profile => {
        const option = document.createElement('option');
        option.value = profile.name;
        option.textContent = profile.name;
        profileSelect.appendChild(option);
      });
    } catch (err) {
      console.error('Failed to load MikroTik configs', err);
    }
  }

  // Load and render hotspot plans
  async function loadHotspotPlans() {
    try {
      const response = await fetch(hotspotApiUrl);
      const plans = await response.json();

      const tbody = document.getElementById('hotspotPlansTable');
      tbody.innerHTML = '';

      plans.forEach(plan => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${plan.name}</td>
          <td>${plan.price}</td>
          <td>${plan.duration}</td>
          <td>${plan.speed}</td>
          <td>${plan.mikrotikServer}</td>
          <td>${plan.mikrotikProfile}</td>
          <td>
            <button onclick="editHotspotPlan('${plan._id}')">Edit</button>
            <button onclick="deleteHotspotPlan('${plan._id}')">Delete</button>
          </td>
        `;
        tbody.appendChild(row);
      });
    } catch (err) {
      console.error('Failed to load plans', err);
    }
  }

  // Edit existing plan
  async function editHotspotPlan(id) {
    try {
      const response = await fetch(`${hotspotApiUrl}/${id}`);
      const plan = await response.json();

      document.getElementById('plan-Name').value = plan.name;
      document.getElementById('plan-Price').value = plan.price;
      document.getElementById('plan-Duration').value = plan.duration;
      document.getElementById('planSpeed').value = plan.speed;
      document.getElementById('mikrotikServer').value = plan.mikrotikServer;
      document.getElementById('mikrotikProfile').value = plan.mikrotikProfile;
      document.getElementById('sharedSecret').value = plan.sharedSecret || '';

      editingId = id;
    } catch (err) {
      console.error('Error editing plan:', err);
    }
  }

  // Delete plan
  async function deleteHotspotPlan(id) {
    if (!confirm('Delete this plan?')) return;

    try {
      const response = await fetch(`${hotspotApiUrl}/${id}`, { method: 'DELETE' });

      if (!response.ok) throw new Error('Delete failed');
      alert('Plan deleted');
      loadHotspotPlans();
    } catch (err) {
      console.error('Error deleting plan:', err);
    }
  }

 document.addEventListener('DOMContentLoaded', () => {
  const serverSelect = document.getElementById('mikrotikServer');
const loaderDiv = document.getElementById('hotspotLoaders');

async function loadHotspotServers() {
  loaderDiv.style.display = 'block';

  try {
    const res = await fetch('https://isp-billing-uq58.onrender.com/api/hotspot/servers');
    const data = await res.json();

    // Ensure we have the expected array
    const servers = data.servers;
    if (!Array.isArray(servers)) throw new Error('Invalid server list format');

    serverSelect.innerHTML = '<option value="">Select Hotspot Server</option>';
    
    servers.forEach(server => {
      const option = document.createElement('option');
      option.value = server.name;
      option.textContent = `${server.name} (${server.interface || 'no interface'})`;
      serverSelect.appendChild(option);
    });

  } catch (err) {
    console.error('Failed to load hotspot servers:', err);
  } finally {
    loaderDiv.style.display = 'none';
  }
}


  const profileSelect = document.getElementById('mikrotikProfile');
async function loadHotspotProfiles() {
  loaderDiv.style.display = 'block';

  try {
    const res = await fetch('https://isp-billing-uq58.onrender.com/api/hotspot/profiles');
    const data = await res.json();

    const profiles = data.profiles;
    if (!Array.isArray(profiles)) throw new Error('Invalid profile list format');

    profileSelect.innerHTML = '<option value="">Select Hotspot Profile</option>';

    profiles.forEach(profile => {
      const option = document.createElement('option');
      option.value = profile.name;
      option.textContent = `${profile.name} (${profile.rateLimit || 'no limit'})`;
      profileSelect.appendChild(option);
    });

  } catch (err) {
    console.error('Failed to load hotspot profiles:', err);
  } finally {
    loaderDiv.style.display = 'none';
  }
}

  // Trigger both
  loadHotspotServers();
  loadHotspotProfiles();
});
