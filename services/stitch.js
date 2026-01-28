// services/stitch.js - MOCK MODE

// We don't need Axios or Credentials in Mock Mode
// We just pretend to create a link

async function createPaymentLink(amount, compoundReference) {
    console.log(`⚠️ MOCK MODE: Generating link for R${amount} with ref ${compoundReference}`);
    
    // Simulate a 1-second delay (like a real bank)
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Return a fake URL.
    // We attach the 'ref' so we can see it in the browser if we want.
    return `https://seabe-demo.com/pay?amount=${amount}&ref=${compoundReference}`;
}

module.exports = { createPaymentLink };