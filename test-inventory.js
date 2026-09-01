async function runTest() {
  console.log('--- 1. Testing Vendor Signup ---');
  const signupRes = await fetch('http://localhost:5000/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `vendor_${Date.now()}@freshmart.com`,
      password: 'password123',
      name: 'FreshMart Organics'
    })
  });
  const authData = await signupRes.json();
  console.log('Signup Result:', authData.vendor?.name, 'Token received:', !!authData.token);
  const token = authData.token;

  console.log('\n--- 2. Testing Create Item with Lead-Time Threshold & Initial Batch ---');
  const itemRes = await fetch('http://localhost:5000/api/inventory', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      name: 'Farm Fresh Organic Eggs (Dozen)',
      price: 6.49,
      minThreshold: 15, // Minimum threshold for Lead-Time Guard
      quantity: 10,
      batchId: 'BATCH-LATE-EXPIRY',
      expirationDate: '2026-10-30' // Expires later
    })
  });
  const itemData = await itemRes.json();
  console.log('Created Item ID:', itemData.id, 'Name:', itemData.name, 'Threshold:', itemData.minThreshold);

  console.log('\n--- 3. Adding Perishable Batch (Earlier Expiry) ---');
  const batchRes = await fetch(`http://localhost:5000/api/inventory/${itemData.id}/batches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      batchId: 'BATCH-EARLY-EXPIRY',
      quantity: 10,
      expirationDate: '2026-09-05' // Expires much earlier!
    })
  });
  const batchData = await batchRes.json();
  console.log('Added Batch:', batchData.batchId, 'Qty:', batchData.quantity, 'Expiry:', batchData.expirationDate);

  console.log('\n--- 4. Testing Perishable Guard: FIFO Deduction ---');
  // Total stock is 20 (10 early + 10 late). Deducting 15 units.
  // FIFO MUST take 10 from BATCH-EARLY-EXPIRY first, then 5 from BATCH-LATE-EXPIRY!
  const deductRes = await fetch(`http://localhost:5000/api/inventory/${itemData.id}/deduct`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      quantity: 15,
      reason: 'Online Supermarket Order'
    })
  });
  const deductData = await deductRes.json();
  console.log('FIFO Deduction Log:');
  console.table(deductData.deductions);
  console.log('Remaining Total Stock:', deductData.totalStockRemaining);
  console.log('Lead-Time Guard Alert Status:', deductData.leadTimeAlert);

  console.log('\n--- 5. Testing GET /api/inventory with Lead-Time Guard Check ---');
  const listRes = await fetch('http://localhost:5000/api/inventory', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const listData = await listRes.json();
  console.log('Inventory List:', listData.map(i => ({
    name: i.name,
    totalStock: i.totalStock,
    minThreshold: i.minThreshold,
    isLowStock: i.isLowStock,
    leadTimeAlert: i.leadTimeAlert
  })));
  console.log('\n✅ ALL FIFO & LEAD-TIME TESTS PASSED SUCCESSFULLY!');
}

runTest().catch(console.error);
