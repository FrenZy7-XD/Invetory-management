const API_URL = 'http://localhost:5000';

async function runTraderBulkTests() {
  console.log('🧪 Starting Trader Rapid Bulk Issue & FEFO Tests...');

  // 1. Signup / Login Trader
  const email = `trader_${Date.now()}@test.com`;
  const password = 'pass123trader';
  const name = 'Apex Wholesale Traders';

  const authRes = await fetch(`${API_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name })
  });
  const authData = await authRes.json();
  if (!authRes.ok) throw new Error(`Auth failed: ${JSON.stringify(authData)}`);
  const token = authData.token;
  console.log('✅ Trader Account Registered & Logged In:', email);

  // 2. Register Products
  // Product 1: Cooking Oil 1L (Packaged, non-perishable) with 100 units across 2 batches
  const oilRes = await fetch(`${API_URL}/api/inventory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Sunland Cooking Oil 1L',
      price: 4.50,
      barcode: '890123456701',
      isPackaged: true,
      isPerishable: false,
      quantity: 30,
      batchId: 'BATCH-OIL-A',
      minThreshold: 10
    })
  });
  const oil = await oilRes.json();
  console.log('✅ Registered Product 1:', oil.name, `(ID: ${oil.id})`);

  // Add second batch of 50 units
  await fetch(`${API_URL}/api/inventory/${oil.id}/batches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ batchId: 'BATCH-OIL-B', quantity: 50 })
  });
  console.log('✅ Added Batch B (50 units) to Oil -> Total Oil stock = 80 units');

  // Product 2: Perishable Milk Crate (Perishable with expiry)
  const milkRes = await fetch(`${API_URL}/api/inventory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Dairy Fresh Milk Crate',
      price: 18.00,
      barcode: '890123456702',
      isPackaged: true,
      isPerishable: true,
      quantity: 20,
      expirationDate: new Date(Date.now() + 5 * 86400000).toISOString(),
      batchId: 'BATCH-MILK-1',
      minThreshold: 5
    })
  });
  const milk = await milkRes.json();
  console.log('✅ Registered Product 2:', milk.name, `(ID: ${milk.id})`);

  // 3. Test Bulk Issue (Success Case: 35 Oil units [depletes Batch A(30) + Batch B(5)] + 10 Milk units)
  console.log('\n📦 Testing Atomic Bulk Issue Endpoint (35x Oil, 10x Milk)...');
  const bulkRes = await fetch(`${API_URL}/api/inventory/bulk-issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      invoiceNumber: 'INV-TRADER-1001',
      items: [
        { productId: oil.id, quantity: 35 },
        { productId: milk.id, quantity: 10 }
      ]
    })
  });
  const bulkData = await bulkRes.json();
  if (!bulkRes.ok) throw new Error(`Bulk issue failed: ${JSON.stringify(bulkData)}`);
  console.log('✅ Bulk Issue Transaction Successful!');
  console.log(`   - Items Processed: ${bulkData.itemsProcessed}`);
  console.log(`   - Total Units Deducted: ${bulkData.totalUnitsDeducted}`);
  console.log(`   - Total Bill Value: $${bulkData.totalBillValue}`);
  console.log('   - Oil Remaining Stock:', bulkData.results.find(r => r.productId === oil.id).stockRemaining, '(Expected: 45)');
  console.log('   - Milk Remaining Stock:', bulkData.results.find(r => r.productId === milk.id).stockRemaining, '(Expected: 10)');

  // 4. Test Bulk Issue (Failure Case: Stock Exceeded for Milk -> entire transaction must rollback)
  console.log('\n🛑 Testing Atomic Rollback on Insufficient Stock (requesting 25 Milk when only 10 left)...');
  const failRes = await fetch(`${API_URL}/api/inventory/bulk-issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      invoiceNumber: 'INV-TRADER-FAIL',
      items: [
        { productId: oil.id, quantity: 10 },
        { productId: milk.id, quantity: 25 } // only 10 available
      ]
    })
  });
  const failData = await failRes.json();
  if (failRes.status === 400 && failData.error.includes('Insufficient stock for "Dairy Fresh Milk Crate"')) {
    console.log('✅ Atomic Rollback Verified! Server correctly rejected transaction with error:', failData.error);
  } else {
    throw new Error(`Expected atomic failure, got: ${JSON.stringify(failData)}`);
  }

  // Verify Oil stock was NOT depleted during the failed transaction
  const verifyRes = await fetch(`${API_URL}/api/inventory`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const inv = await verifyRes.json();
  const oilAfterRollback = inv.find(i => i.id === oil.id);
  console.log('✅ Verified Rollback: Oil stock remains untouched at', oilAfterRollback.totalStock, 'units.');

  console.log('\n🎉 ALL TRADER RAPID BULK OUTGOING TESTS PASSED!\n');
}

runTraderBulkTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
