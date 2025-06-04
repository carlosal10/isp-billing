

document.addEventListener('DOMContentLoaded', () => {
    const addPlanButton = document.getElementById('addPlanButton');
    const addPlanForm = document.getElementById('addPlanForm');
    const closePlanFormButton = document.getElementById('closePlanForm');
    const planForm = document.getElementById('planForm');
    let editingPlanId = null;

    // Show the add plan form
    addPlanButton.addEventListener('click', () => {
        addPlanForm.style.display = 'block';
    });

    // Close the add plan form
    closePlanFormButton.addEventListener('click', () => {
        addPlanForm.style.display = 'none';
    });

    // Handle form submission for adding or updating a plan
    planForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const planData = {
            name: document.getElementById('planName').value.trim(),
            description: document.getElementById('planDescription').value.trim(),
            price: parseFloat(document.getElementById('planPrice').value.trim()),
            duration: document.getElementById('planDuration').value.trim(),
        };

        try {
            let response;

            if (editingPlanId) {
                // Update an existing plan
                response = await fetch(`${plansApiUrl}/${editingPlanId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(planData),
                });
            } else {
                // Add a new plan
                response = await fetch(plansApiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(planData),
                });
            }

            if (response.ok) {
                alert('Plan saved successfully!');
                planForm.reset();
                addPlanForm.style.display = 'none'; // Hide form
                loadPlans(); // Refresh the plans table
            } else {
                alert('Failed to save plan!');
            }
        } catch (err) {
            console.error('Error saving plan:', err);
        }
    });

    // Load plans on page load
    loadPlans();
});

// Fetch and display plans
async function loadPlans() {
    try {
        const response = await fetch(plansApiUrl);
        const plans = await response.json();
        const plansTable = document.getElementById('plansTable');
        plansTable.innerHTML = ''; // Clear the table before re-rendering

        plans.forEach((plan) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${plan._id}</td>
                <td>${plan.name}</td>
                <td>${plan.description}</td>
                <td>${plan.price}</td>
                <td>${plan.duration}</td>
                <td>
                    <button onclick="editPlan('${plan._id}')">Edit</button>
                    <button onclick="deletePlan('${plan._id}')">Delete</button>
                </td>
            `;
            plansTable.appendChild(row);
        });
    } catch (err) {
        console.error('Error fetching plans:', err);
    }
}

// Edit plan
function editPlan(id) {
    // Fetch the plan data
    fetch(`${apiUrl}/${id}`)
        .then(response => response.json())
        .then(plan => {
            // Pre-fill the form with plan data
            document.getElementById('planName').value = plan.name;
            document.getElementById('planDescription').value = plan.description;
            document.getElementById('planPrice').value = plan.price;
            document.getElementById('planDuration').value = plan.duration;

            // Show the form and set the editing state
            addPlanForm.style.display = 'block';
            editingPlanId = id;
        })
        .catch(err => {
            console.error('Error fetching plan data for edit:', err);
        });
}

// Delete plan
async function deletePlan(id) {
    if (!confirm('Are you sure you want to delete this plan?')) return;

    try {
        const response = await fetch(`${apiUrl}/${id}`, { method: 'DELETE' });

        if (response.ok) {
            alert('Plan deleted successfully!');
            loadPlans(); // Refresh the plans table
        } else {
            alert('Failed to delete plan!');
        }
    } catch (err) {
        console.error('Error deleting plan:', err);
    }
}
