const apiUrl = 'https://isp-billing-uq58.onrender.com/api/customers';
const plansApiUrl = 'https://isp-billing-uq58.onrender.com/api/plans';

document.addEventListener('DOMContentLoaded', () => {
  const addCustomerButton = document.getElementById('addCustomerButton');
  const formOverlay = document.getElementById('formOverlay');
  const addCustomerForm = document.getElementById('addCustomerForm');
  const closeFormButton = document.getElementById('closeAddCustomerForm');
  const customerForm = document.getElementById('customerForm');
  const planDropdown = document.getElementById('plan');

  let editingCustomerId = null;

  // Show Add Customer form and overlay
  addCustomerButton.addEventListener('click', () => {
    loadPlans();  // Load plans before showing form
    resetForm();
    formOverlay.style.display = 'block';
    addCustomerForm.style.display = 'block';
  });

  // Hide form and overlay
  const hideForm = () => {
    formOverlay.style.display = 'none';
    addCustomerForm.style.display = 'none';
    editingCustomerId = null;
  };
  closeFormButton.addEventListener('click', hideForm);
  formOverlay.addEventListener('click', hideForm);

  // Reset form fields
  const resetForm = () => {
    customerForm.reset();
    editingCustomerId = null;
    document.getElementById('accountNumber').value = ''; // clear readonly
  };

  // Load plans into dropdown
  async function loadPlans() {
    try {
      const response = await fetch(plansApiUrl);
      const plans = await response.json();
      planDropdown.innerHTML = '<option value="">-- Select Plan --</option>';
      plans.forEach(plan => {
        const option = document.createElement('option');
        option.value = plan._id;
        option.textContent = `${plan.name} - $${plan.price} (${plan.duration})`;
        planDropdown.appendChild(option);
      });
    } catch (error) {
      console.error('Error loading plans:', error);
      alert('Failed to load plans. Please try again.');
    }
  }

  // Handle form submission (Add/Edit)
  customerForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const customerData = {
      name: document.getElementById('name').value.trim(),
      email: document.getElementById('email').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      address: document.getElementById('address').value.trim(),
      accountNumber: document.getElementById('accountNumber').value.trim(),
      plan: planDropdown.value,
      routerIp: document.getElementById('routerIp').value.trim(),
    };

    // Basic validation
    if (!customerData.name || !customerData.email || !customerData.phone || !customerData.plan) {
      alert('Name, Email, Phone, and Plan are required.');
      return;
    }

    try {
      const method = editingCustomerId ? 'PUT' : 'POST';
      const url = editingCustomerId ? `${apiUrl}/${editingCustomerId}` : apiUrl;

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customerData),
      });

      if (response.ok) {
        alert(`Customer ${editingCustomerId ? 'updated' : 'added'} successfully.`);
        loadCustomers();
        hideForm();
      } else {
        alert(`Failed to ${editingCustomerId ? 'update' : 'add'} customer.`);
      }
    } catch (error) {
      console.error('Error saving customer:', error);
      alert('An error occurred. Please try again.');
    }
  });

  // Load and render customers table
  async function loadCustomers() {
    try {
      const response = await fetch(apiUrl);
      const customers = await response.json();
      const customersTable = document.getElementById('customersTable');
      customersTable.innerHTML = '';

      customers.forEach(customer => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${customer._id}</td>
          <td>${customer.name}</td>
          <td>${customer.email}</td>
          <td>${customer.phone}</td>
          <td>${customer.address || ''}</td>
          <td>${customer.accountNumber || ''}</td>
          <td>${customer.plan?.name || 'N/A'}</td>
          <td>${customer.routerIp || ''}</td>
          <td>
            <button onclick="editCustomer('${customer._id}')">Edit</button>
            <button onclick="deleteCustomer('${customer._id}')">Delete</button>
          </td>
        `;
        customersTable.appendChild(row);
      });
    } catch (error) {
      console.error('Error loading customers:', error);
    }
  }

  // Edit customer - populate form and open it
  window.editCustomer = async (id) => {
    try {
      const response = await fetch(`${apiUrl}/${id}`);
      const customer = await response.json();

      document.getElementById('name').value = customer.name;
      document.getElementById('email').value = customer.email;
      document.getElementById('phone').value = customer.phone;
      document.getElementById('address').value = customer.address || '';
      document.getElementById('accountNumber').value = customer.accountNumber || '';
      planDropdown.value = customer.plan?._id || '';
      document.getElementById('routerIp').value = customer.routerIp || '';

      editingCustomerId = id;
      loadPlans(); // Refresh plans to ensure dropdown is updated

      formOverlay.style.display = 'block';
      addCustomerForm.style.display = 'block';
    } catch (error) {
      console.error('Error fetching customer:', error);
      alert('Failed to load customer data.');
    }
  };

  // Delete customer
  window.deleteCustomer = async (id) => {
    if (!confirm('Are you sure you want to delete this customer?')) return;

    try {
      const response = await fetch(`${apiUrl}/${id}`, { method: 'DELETE' });
      if (response.ok) {
        alert('Customer deleted successfully.');
        loadCustomers();
      } else {
        alert('Failed to delete customer.');
      }
    } catch (error) {
      console.error('Error deleting customer:', error);
    }
  };

  // Initial load
  loadCustomers();
});
