const apiUrl = 'https://isp-billing-uq58.onrender.com/api/customers';
const plansApiUrl = 'https://isp-billing-uq58.onrender.com/api/plans';

document.addEventListener('DOMContentLoaded', () => {
    const addCustomerButton = document.getElementById('addCustomerButton');
    const addCustomerForm = document.getElementById('addCustomerForm');
    const formOverlay = document.getElementById('formOverlay');
    const closeFormButton = document.getElementById('closeForm');
    const customerForm = document.getElementById('customerForm');
    const planDropdown = document.getElementById('plan'); // Dropdown for plans
    const profileDropdown = document.getElementById('profile'); 

    let editingCustomerId = null; // Track if we are editing a customer

    // Show popup form
    addCustomerButton.addEventListener('click', () => {
        loadPlans(); // Load plans dynamically into the dropdown
        resetForm();
        showForm();
    });

    // Hide popup form
    const hidePopupForm = () => {
        addCustomerForm.style.display = 'none';
        formOverlay.style.display = 'none';
        editingCustomerId = null; // Reset editing state
    };

    closeFormButton.addEventListener('click', hidePopupForm);
    formOverlay.addEventListener('click', hidePopupForm);

    // Show the form
    const showForm = () => {
        addCustomerForm.style.display = 'block';
        formOverlay.style.display = 'block';
    };

    // Reset form fields
    const resetForm = () => {
        customerForm.reset();
        editingCustomerId = null;
    };

    // Load plans into dropdown
    async function loadPlans() {
    try {
        const response = await fetch(plansApiUrl, apiUrl,);
        const plans = await response.json();

        // Populate Plan Dropdown (e.g., for invoice/payment form)
        const planDropdown = document.getElementById('planDropdown');
        if (planDropdown) {
            planDropdown.innerHTML = '<option value="">Select Plan</option>';
            plans.forEach(plan => {
                const option = document.createElement('option');
                option.value = plan._id;
                option.textContent = `${plan.name} - $${plan.price} (${plan.duration})`;
                planDropdown.appendChild(option);
            });
        }

        // Populate Profile Dropdown (e.g., PPPoE modal)
        const profileDropdown = document.getElementById('profile');
        if (profileDropdown) {
            profileDropdown.innerHTML = '<option value="">Select Profile</option>';
            plans.forEach(plan => {
                const option = document.createElement('option');
                option.value = plan.name;
                option.textContent = `${plan.name} - ${plan.duration}`;
                profileDropdown.appendChild(option);
            });
        }

    } catch (error) {
        console.error('Error fetching plans:', error);
        alert('Failed to load plans. Please refresh and try again.');
    }
}


    // Handle form submission
    customerForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const customerData = {
            name: document.getElementById('name').value.trim(),
            email: document.getElementById('email').value.trim(),
            phone: document.getElementById('phone').value.trim(),
            address: document.getElementById('address').value.trim(),
            routerIp: document.getElementById('routerIp').value.trim(),
            plan: planDropdown.value,
        };

        // Validation
        if (!customerData.name || !customerData.email || !customerData.phone || !customerData.plan) {
            alert('Name, Email, Phone, and Plan are required fields.');
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
                alert(`Customer ${editingCustomerId ? 'updated' : 'added'} successfully!`);
                loadCustomers(); // Refresh table
                hidePopupForm();
            } else {
                alert(`Failed to ${editingCustomerId ? 'update' : 'add'} customer.`);
            }
        } catch (error) {
            console.error('Error saving customer:', error);
            alert('An error occurred. Please try again.');
        }
    });

    // Load customers into table
    async function loadCustomers() {
        try {
            const response = await fetch(apiUrl);
            const customers = await response.json();
            const customersTable = document.getElementById('customersTable');
            customersTable.innerHTML = ''; // Clear the table

            customers.forEach(customer => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${customer._id}</td>
                    <td>${customer.name}</td>
                    <td>${customer.email}</td>
                    <td>${customer.phone}</td>
                    <td>${customer.address}</td>
                    <td>${customer.accountNumber}</td>
                    <td>${customer.plan?.name || 'N/A'}</td> <!-- Show plan name -->
                    <td>${customer.routerIp || 'N/A'}</td>
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

    // Delete customer
    async function deleteCustomer(id) {
        if (!confirm('Are you sure you want to delete this customer?')) return;

        try {
            const response = await fetch(`${apiUrl}/${id}`, { method: 'DELETE' });

            if (response.ok) {
                alert('Customer deleted successfully!');
                loadCustomers();
            } else {
                alert('Failed to delete customer.');
            }
        } catch (error) {
            console.error('Error deleting customer:', error);
        }
    }

    // Edit customer
    window.editCustomer = async (id) => {
        try {
            const response = await fetch(`${apiUrl}/${id}`);
            const customer = await response.json();

            // Pre-fill form with customer data
            document.getElementById('name').value = customer.name;
            document.getElementById('email').value = customer.email;
            document.getElementById('phone').value = customer.phone;
            document.getElementById('address').value = customer.address;
            document.getElementById('routerIp').value = customer.routerIp || '';
            planDropdown.value = customer.plan || '';

            showForm();
            editingCustomerId = id; // Set editing state
            loadPlans(); // Reload plans
        } catch (error) {
            console.error('Error editing customer:', error);
            alert('Failed to load customer details for editing.');
        }
    };

    // Expose deleteCustomer to global scope
    window.deleteCustomer = deleteCustomer;

    // Initial load
    loadCustomers();
});
