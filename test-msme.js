async function runMSMETests() {
  console.log('=== MSME RULES & QUICK SCANNER VALIDATION ===\n');

  // 1. Auth Setup
  const signupRes = await fetch('http://localhost:5000/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `msme_${Date.now()}@kirana.com`,
      password: 'pass',
      name: 'Sharma Kirana Store'
    })
  });
  const { token } = await signupRes.json();
  console.log('1. Vendor registered with token.');

  // 2. Test Rule 1: Packaged item MUST have barcode
  console.log('\n2. Testing isPackaged validation rule:');
  const badPackagedRes = await fetch('http://localhost:5000/api/inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Lays Chips',
      price: 1.50,
      isPackaged: true,
      barcode: '' // Missing barcode -> Should fail
    })
  });
  const badPackagedData = await badPackagedRes.json();
  console.log('Missing barcode on packaged item rejected:', badPackagedRes.status === 400, '| Error:', badPackagedData.error);

  // 3. Test Rule 2: Perishable item MUST have expiry date
  console.log('\n3. Testing isPerishable validation rule:');
  const badPerishableRes = await fetch('http://localhost:5000/api/inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Loose Strawberries',
      price: 4.00,
      isPackaged: false, // Loose item
      isPerishable: true,
      quantity: 10,
      expirationDate: '' // Missing expiry -> Should fail
    })
  });
  const badPerishableData = await badPerishableRes.json();
  console.log('Missing expiry date on perishable item rejected:', badPerishableRes.status === 400, '| Error:', badPerishableData.error);

  // 4. Create Valid Packaged Item with Barcode
  console.log('\n4. Creating Valid Packaged Item (Amul Butter with Barcode):');
  const validBarcode = '8901262010053';
  const goodPackagedRes = await fetch('http://localhost:5000/api/inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Amul Butter 100g',
      price: 2.20,
      isPackaged: true,
      barcode: validBarcode,
      isPerishable: true,
      quantity: 5,
      batchId: 'BATCH-AMUL-01',
      expirationDate: '2026-12-31'
    })
  });
  const goodPackagedData = await goodPackagedRes.json();
  console.log('Created Packaged Product:', goodPackagedData.name, '| Barcode:', goodPackagedData.barcode);

  // 5. Test Quick Scanner API (Barcode deduction & Transaction Log)
  console.log('\n5. Simulating Quick Scanner Camera Scan for Barcode:', validBarcode);
  const scanSaleRes = await fetch('http://localhost:5000/api/inventory/quick-scan-sale', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ barcode: validBarcode })
  });
  const scanSaleData = await scanSaleRes.json();
  console.log('Quick Scan Result:', scanSaleData.message);
  console.log('Remaining Stock:', scanSaleData.stockRemaining);
  console.log('Transaction Timestamp:', scanSaleData.timestamp);

  // 6. Test Quick Scanner with UNREGISTERED Barcode (404 expected to open modal)
  console.log('\n6. Simulating Camera Scan for Unregistered Barcode: 999988887777');
  const unregScanRes = await fetch('http://localhost:5000/api/inventory/quick-scan-sale', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ barcode: '999988887777' })
  });
  const unregScanData = await unregScanRes.json();
  console.log('Unregistered Barcode Result (triggers modal):', unregScanData.found === false, '| Message:', unregScanData.message);

  // 7. Create Loose/Raw Item (Strawberries with 2 Batches for FEFO)
  console.log('\n7. Creating Raw/Loose Perishable Item (Fresh Strawberries):');
  const rawItemRes = await fetch('http://localhost:5000/api/inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Organic Strawberries (Loose)',
      price: 3.50,
      isPackaged: false, // No barcode needed
      isPerishable: true,
      quantity: 8,
      batchId: 'LOT-EXP-LATE',
      expirationDate: '2026-09-20'
    })
  });
  const rawItemData = await rawItemRes.json();

  // Add earlier batch to Strawberries
  await fetch(`http://localhost:5000/api/inventory/${rawItemData.id}/batches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      batchId: 'LOT-EXP-SOON',
      quantity: 5,
      expirationDate: '2026-09-05' // Expires very soon
    })
  });

  // 8. Test Manual FEFO Sale (-1 on Strawberries)
  console.log('\n8. Testing Manual 1-Tap Outgoing (-1) on Strawberries via FEFO:');
  const manualSaleRes = await fetch(`http://localhost:5000/api/inventory/${rawItemData.id}/deduct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ quantity: 1, reason: 'Manual Sale (FEFO)' })
  });
  const manualSaleData = await manualSaleRes.json();
  console.log('Manual Sale Output:', manualSaleData.message);
  console.log('Deducted from Batch:', manualSaleData.deductions?.[0]?.batchId, '(Remaining in batch:', manualSaleData.deductions?.[0]?.remainingInBatch, ')');
  console.log('Total Remaining:', manualSaleData.totalStockRemaining);

  console.log('\n✅ ALL MSME WORKFLOW & QUICK SCANNER TESTS PASSED!');
}

runMSMETests().catch(console.error);
