import { useState, useEffect } from 'react';

export default function Dashboard({ token, setToken }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Add Item state
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [minThreshold, setMinThreshold] = useState(5);
  const [initialQty, setInitialQty] = useState('');
  const [batchId, setBatchId] = useState('');
  const [expirationDate, setExpirationDate] = useState('');

  // Modal / Action states
  const [selectedItemForBatch, setSelectedItemForBatch] = useState(null);
  const [newBatchId, setNewBatchId] = useState('');
  const [newBatchQty, setNewBatchQty] = useState('');
  const [newBatchExpiry, setNewBatchExpiry] = useState('');

  const [selectedItemForDeduct, setSelectedItemForDeduct] = useState(null);
  const [deductQty, setDeductQty] = useState('');
  const [deductionResult, setDeductionResult] = useState(null);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:5000/api/inventory', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setItems(data);
      } else if (res.status === 401 || res.status === 403) {
        setToken(null);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to connect to backend server.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchItems();
  }, [token]);

  const handleAddItem = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await fetch('http://localhost:5000/api/inventory', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ 
          name, 
          price: Number(price),
          minThreshold: Number(minThreshold),
          quantity: initialQty ? Number(initialQty) : 0,
          batchId: batchId || undefined,
          expirationDate: expirationDate || undefined
        })
      });
      const data = await res.json();
      if (res.ok) {
        setName(''); setPrice(''); setMinThreshold(5); setInitialQty(''); setBatchId(''); setExpirationDate('');
        setSuccessMsg(`Item "${name}" created successfully.`);
        fetchItems();
      } else {
        setErrorMsg(data.error || 'Failed to add item');
      }
    } catch (err) {
      setErrorMsg('Server connection failed.');
    }
  };

  const handleAddBatch = async (e) => {
    e.preventDefault();
    if (!selectedItemForBatch) return;
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await fetch(`http://localhost:5000/api/inventory/${selectedItemForBatch.id}/batches`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          batchId: newBatchId || undefined,
          quantity: Number(newBatchQty),
          expirationDate: newBatchExpiry
        })
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(`Batch added to "${selectedItemForBatch.name}".`);
        setSelectedItemForBatch(null);
        setNewBatchId(''); setNewBatchQty(''); setNewBatchExpiry('');
        fetchItems();
      } else {
        setErrorMsg(data.error || 'Failed to add batch.');
      }
    } catch (err) {
      setErrorMsg('Server connection failed.');
    }
  };

  const handleDeductFIFO = async (e) => {
    e.preventDefault();
    if (!selectedItemForDeduct) return;
    setErrorMsg('');
    setSuccessMsg('');
    setDeductionResult(null);

    try {
      const res = await fetch(`http://localhost:5000/api/inventory/${selectedItemForDeduct.id}/deduct`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          quantity: Number(deductQty),
          reason: 'Order Fulfillment / Sale'
        })
      });
      const data = await res.json();
      if (res.ok) {
        setDeductionResult(data);
        setSuccessMsg(data.message);
        setDeductQty('');
        fetchItems();
      } else {
        setErrorMsg(data.error || 'Failed to deduct stock.');
      }
    } catch (err) {
      setErrorMsg('Server connection failed.');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this item and all its batches?')) return;
    try {
      const res = await fetch(`http://localhost:5000/api/inventory/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setSuccessMsg('Item deleted successfully.');
        fetchItems();
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Multi-Tenant Inventory Control</h1>
          <p className="text-sm text-gray-500 mt-1">
            🛡️ <span className="font-semibold text-emerald-700">Perishable Guard (FIFO)</span> & ⚠️ <span className="font-semibold text-amber-700">Lead-Time Guard</span>
          </p>
        </div>
        <button 
          onClick={() => setToken(null)}
          className="bg-red-50 hover:bg-red-100 text-red-600 font-medium px-4 py-2 rounded-lg transition"
        >
          Sign Out
        </button>
      </div>

      {/* Notifications */}
      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 flex justify-between items-center">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} className="font-bold">×</button>
        </div>
      )}
      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-lg mb-6 flex justify-between items-center">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg('')} className="font-bold">×</button>
        </div>
      )}

      {/* Deduction Report Modal / Callout */}
      {deductionResult && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 mb-8">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-bold text-indigo-900 text-lg">⚡ FIFO Deduction Audit Trail</h3>
            <button onClick={() => setDeductionResult(null)} className="text-indigo-600 hover:text-indigo-800 text-sm font-semibold">Dismiss</button>
          </div>
          <p className="text-sm text-indigo-800 mb-3">{deductionResult.message}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left bg-white rounded-lg shadow-xs">
              <thead className="bg-indigo-100/70 text-indigo-900">
                <tr>
                  <th className="p-2">Batch ID</th>
                  <th className="p-2">Expiry Date</th>
                  <th className="p-2">Units Deducted</th>
                  <th className="p-2">Remaining in Batch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {deductionResult.deductions.map((d, idx) => (
                  <tr key={idx}>
                    <td className="p-2 font-mono font-medium">{d.batchId}</td>
                    <td className="p-2 text-gray-600">{new Date(d.expirationDate).toLocaleDateString()}</td>
                    <td className="p-2 text-red-600 font-bold">-{d.deducted}</td>
                    <td className="p-2 text-gray-800">{d.remainingInBatch}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {deductionResult.leadTimeAlert && (
            <div className="mt-3 p-2 bg-amber-100 border border-amber-300 text-amber-900 text-xs rounded-md font-medium">
              {deductionResult.leadTimeAlert}
            </div>
          )}
        </div>
      )}

      {/* Add New Product Form */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-8">
        <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <span>➕</span> Register New Inventory Item
        </h2>
        <form onSubmit={handleAddItem} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Item Name *</label>
            <input 
              className="w-full border border-gray-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
              placeholder="e.g. Organic Whole Milk" 
              value={name} 
              onChange={e => setName(e.target.value)} 
              required 
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Price ($) *</label>
            <input 
              className="w-full border border-gray-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
              type="number" 
              step="0.01" 
              placeholder="4.99" 
              value={price} 
              onChange={e => setPrice(e.target.value)} 
              required 
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
              Lead-Time Threshold (Min Stock)
            </label>
            <input 
              className="w-full border border-gray-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
              type="number" 
              placeholder="5" 
              value={minThreshold} 
              onChange={e => setMinThreshold(e.target.value)} 
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Initial Batch Qty</label>
            <input 
              className="w-full border border-gray-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
              type="number" 
              placeholder="e.g. 50" 
              value={initialQty} 
              onChange={e => setInitialQty(e.target.value)} 
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Batch Code / ID</label>
            <input 
              className="w-full border border-gray-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
              placeholder="e.g. BATCH-2026-A" 
              value={batchId} 
              onChange={e => setBatchId(e.target.value)} 
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Batch Expiration Date</label>
            <input 
              className="w-full border border-gray-300 p-2.5 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
              type="date" 
              value={expirationDate} 
              onChange={e => setExpirationDate(e.target.value)} 
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
            <button className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2.5 rounded-lg transition shadow-sm" type="submit">
              Add Inventory Item
            </button>
          </div>
        </form>
      </div>

      {/* Inventory Items List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-800">Your Isolated Tenant Inventory</h2>
          <button onClick={fetchItems} className="text-sm text-blue-600 hover:underline">🔄 Refresh</button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading inventory data...</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No inventory items found. Add your first item above!</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map(item => {
              const activeBatches = (item.batches || []).filter(b => b.quantity > 0);
              return (
                <div key={item.id} className="p-6 hover:bg-gray-50/50 transition">
                  <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-bold text-gray-900">{item.name}</h3>
                        <span className="text-sm font-semibold text-gray-600">${item.price.toFixed(2)}</span>
                        
                        {/* Lead-Time Guard Badge */}
                        {item.isLowStock ? (
                          <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 text-xs px-2.5 py-0.5 rounded-full font-semibold border border-amber-300">
                            ⚠️ Low Stock (Min: {item.minThreshold})
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 text-xs px-2.5 py-0.5 rounded-full font-medium">
                            ✓ Healthy Stock (Min: {item.minThreshold})
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Total Available Units: <span className="font-bold text-gray-800">{item.totalStock}</span> across {activeBatches.length} active batch(es)
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <button 
                        onClick={() => setSelectedItemForBatch(item)}
                        className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold px-3 py-2 rounded-lg border border-emerald-200 transition"
                      >
                        + Add Batch
                      </button>
                      <button 
                        onClick={() => { setSelectedItemForDeduct(item); setDeductionResult(null); }}
                        className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold px-3 py-2 rounded-lg border border-indigo-200 transition"
                      >
                        ⚡ Deduct Stock (FIFO)
                      </button>
                      <button 
                        onClick={() => handleDelete(item.id)}
                        className="bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold px-3 py-2 rounded-lg transition"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* Batch Details (Perishable Guard breakdown) */}
                  <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                    <p className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">
                      Active FIFO Batches (sorted by expiration date):
                    </p>
                    {activeBatches.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">No stock batches in inventory.</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                        {activeBatches.map(batch => {
                          const expiry = new Date(batch.expirationDate);
                          const isExpired = expiry < new Date();
                          return (
                            <div key={batch.id} className="bg-white p-2.5 rounded border border-gray-200 text-xs flex justify-between items-center shadow-2xs">
                              <div>
                                <div className="font-mono font-bold text-gray-700">{batch.batchId}</div>
                                <div className={`text-[11px] ${isExpired ? 'text-red-600 font-bold' : 'text-gray-500'}`}>
                                  Expires: {expiry.toLocaleDateString()} {isExpired ? '(EXPIRED)' : ''}
                                </div>
                              </div>
                              <div className="text-right">
                                <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-bold">{batch.quantity}</span>
                                <span className="text-gray-400 text-[10px] block">/ {batch.initialQuantity} init</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL: ADD BATCH */}
      {selectedItemForBatch && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900 mb-1">Add Batch (Perishable Guard)</h3>
            <p className="text-xs text-gray-500 mb-4">Adding stock to: <span className="font-semibold text-gray-800">{selectedItemForBatch.name}</span></p>
            <form onSubmit={handleAddBatch} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Batch Code / ID</label>
                <input 
                  className="w-full border p-2.5 rounded-lg text-sm" 
                  placeholder="e.g. LOT-2026-99" 
                  value={newBatchId} 
                  onChange={e => setNewBatchId(e.target.value)} 
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Quantity *</label>
                <input 
                  className="w-full border p-2.5 rounded-lg text-sm" 
                  type="number" 
                  placeholder="e.g. 20" 
                  value={newBatchQty} 
                  onChange={e => setNewBatchQty(e.target.value)} 
                  required 
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Expiration Date *</label>
                <input 
                  className="w-full border p-2.5 rounded-lg text-sm" 
                  type="date" 
                  value={newBatchExpiry} 
                  onChange={e => setNewBatchExpiry(e.target.value)} 
                  required 
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button 
                  type="button" 
                  onClick={() => setSelectedItemForBatch(null)} 
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg"
                >
                  Add Batch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: FIFO DEDUCT STOCK */}
      {selectedItemForDeduct && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900 mb-1">⚡ FIFO Stock Deduction</h3>
            <p className="text-xs text-gray-500 mb-3">
              Item: <span className="font-semibold text-gray-800">{selectedItemForDeduct.name}</span> (Total available: <span className="font-bold text-blue-600">{selectedItemForDeduct.totalStock}</span>)
            </p>
            <p className="text-xs text-gray-600 bg-amber-50 p-2.5 rounded-lg border border-amber-200 mb-4">
              🛡️ <strong>FIFO Guard:</strong> Units will be automatically and strictly deducted starting from the earliest expiring batch first.
            </p>
            <form onSubmit={handleDeductFIFO} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Units to Deduct *</label>
                <input 
                  className="w-full border p-2.5 rounded-lg text-sm" 
                  type="number" 
                  placeholder="e.g. 15" 
                  value={deductQty} 
                  onChange={e => setDeductQty(e.target.value)} 
                  max={selectedItemForDeduct.totalStock}
                  required 
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button 
                  type="button" 
                  onClick={() => setSelectedItemForDeduct(null)} 
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg"
                >
                  Execute FIFO Deduction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
