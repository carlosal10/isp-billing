document.getElementById("paymentForm").addEventListener("submit", async function (e) {
    e.preventDefault();

    const accountNumber = document.getElementById("accountNumber").value;
    const phoneNumber = document.getElementById("phoneNumber").value;
    const amount = parseFloat(document.getElementById("amount").value);

    if (!accountNumber || !phoneNumber || !amount) {
        alert("Please fill in all fields.");
        return;
    }

    try {
        // Fetch customer data using the account number
        const response = await fetch(`https://isp-billing-uq58.onrender.com/api/customers/${accountNumber}`);

        const customer = await response.json();

        if (!customer) {
            alert("Customer not found!");
            return;
        }

        // Validate the amount against the customer's assigned plan price
        const planPrice = customer.plan?.price || 0;

        if (amount < planPrice) {
            alert(`Amount should be at least the price of the assigned plan: ${planPrice}`);
            return;
        }

        // If the amount is valid, proceed with the payment
        const paymentData = {
            accountNumber: accountNumber,
            phoneNumber: phoneNumber,
            amount: amount,
        };

        // Send payment data to backend
        const paymentResponse = await fetch('https://isp-billing-uq58.onrender.com/api/payProcess/stkpush', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(paymentData),
        });

        const paymentResult = await paymentResponse.json();

        if (paymentResponse.ok) {
            alert("Payment initiated successfully!");
            console.log(paymentResult);
        } else {
            alert("Payment initiation failed.");
            console.error(paymentResult);
        }
    } catch (err) {
        console.error("Error during payment:", err);
        alert("An error occurred. Please try again.");
    }
});
