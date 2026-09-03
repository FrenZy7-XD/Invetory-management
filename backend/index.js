const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-in-prod';

// Auth Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token.' });
    req.user = user;
    next();
  });
};

// --- AUTH ROUTES ---

app.post('/api/auth/signup', async (req, res) => {
  const { email, password, name } = req.body;
  
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Email, password, and vendor name are required.' });
  }

  try {
    const existingVendor = await prisma.vendor.findUnique({ where: { email } });
    if (existingVendor) {
      return res.status(400).json({ error: 'Vendor already exists with this email.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newVendor = await prisma.vendor.create({
      data: {
        email,
        password: hashedPassword,
        name
      }
    });

    const token = jwt.sign({ vendorId: newVendor.id, email: newVendor.email }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, vendor: { id: newVendor.id, email: newVendor.email, name: newVendor.name } });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ error: 'Internal server error during signup' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const vendor = await prisma.vendor.findUnique({ where: { email } });
    if (!vendor) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const validPassword = await bcrypt.compare(password, vendor.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign({ vendorId: vendor.id, email: vendor.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, vendor: { id: vendor.id, email: vendor.email, name: vendor.name } });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// --- INVENTORY ROUTES ---

// 1. GET ALL ITEMS (With Lead-Time Guard status & Batches for FIFO)
app.get('/api/inventory', authenticateToken, async (req, res) => {
  try {
    const items = await prisma.inventoryItem.findMany({
      where: { vendorId: req.user.vendorId },
      include: {
        batches: {
          orderBy: [
            { expirationDate: 'asc' },
            { createdAt: 'asc' }
          ]
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const now = new Date();

    const formattedItems = items.map(item => {
      const activeBatches = item.batches.filter(b => b.quantity > 0);
      const totalStock = activeBatches.reduce((sum, b) => sum + b.quantity, 0);
      const isLowStock = totalStock <= item.minThreshold;
      const expiredBatchesCount = item.batches.filter(b => b.expirationDate && new Date(b.expirationDate) < now && b.quantity > 0).length;

      return {
        ...item,
        totalStock,
        isLowStock,
        expiredBatchesCount,
        activeBatchesCount: activeBatches.length,
        leadTimeAlert: isLowStock ? `Stock (${totalStock}) has reached or fallen below minimum threshold (${item.minThreshold}). Reorder recommended!` : null
      };
    });

    res.json(formattedItems);
  } catch (error) {
    console.error("Get inventory error:", error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2. CREATE ITEM with MSME Validation Rules:
// - isPackaged: If true, barcode is MANDATORY.
// - isPerishable: If true, expiryDate is MANDATORY. Barcode is optional.
app.post('/api/inventory', authenticateToken, async (req, res) => {
  const { name, price, minThreshold, barcode, isPackaged, isPerishable, batchId, quantity, expirationDate } = req.body;
  
  if (!name || price === undefined) {
    return res.status(400).json({ error: 'Item name and price are required.' });
  }

  const packaged = Boolean(isPackaged);
  const perishable = Boolean(isPerishable);

  // RULE 1: If isPackaged is true, barcode is MANDATORY
  if (packaged && (!barcode || barcode.trim() === '')) {
    return res.status(400).json({ error: 'Validation Error: Barcode is MANDATORY for packaged goods.' });
  }

  // Check unique barcode for this vendor if provided
  if (barcode && barcode.trim() !== '') {
    const existing = await prisma.inventoryItem.findFirst({
      where: { vendorId: req.user.vendorId, barcode: barcode.trim() }
    });
    if (existing) {
      return res.status(400).json({ error: `An item with barcode "${barcode.trim()}" already exists (${existing.name}).` });
    }
  }

  const initialQty = parseInt(quantity, 10) || 0;

  // RULE 2: If isPerishable is true and quantity > 0, expiryDate is MANDATORY
  if (perishable && initialQty > 0 && !expirationDate) {
    return res.status(400).json({ error: 'Validation Error: Expiry date is MANDATORY for perishable items.' });
  }

  try {
    const thresholdVal = minThreshold !== undefined ? parseInt(minThreshold, 10) : 5;

    const newItem = await prisma.inventoryItem.create({
      data: {
        name: name.trim(),
        price: parseFloat(price),
        barcode: barcode && barcode.trim() !== '' ? barcode.trim() : null,
        isPackaged: packaged,
        isPerishable: perishable,
        minThreshold: thresholdVal,
        vendorId: req.user.vendorId,
        ...(initialQty > 0 ? {
          batches: {
            create: {
              batchId: batchId || `BATCH-${Date.now().toString().slice(-6)}`,
              quantity: initialQty,
              initialQuantity: initialQty,
              expirationDate: expirationDate ? new Date(expirationDate) : null,
              vendorId: req.user.vendorId
            }
          }
        } : {})
      },
      include: {
        batches: true
      }
    });

    res.status(201).json(newItem);
  } catch (error) {
    console.error("Create item error:", error);
    res.status(500).json({ error: 'Internal server error while creating item' });
  }
});

// 3. ADD BATCH TO ITEM
app.post('/api/inventory/:id/batches', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { batchId, quantity, expirationDate } = req.body;

  if (!quantity || parseInt(quantity, 10) <= 0) {
    return res.status(400).json({ error: 'Valid positive quantity is required.' });
  }

  try {
    const item = await prisma.inventoryItem.findFirst({
      where: { id, vendorId: req.user.vendorId }
    });

    if (!item) {
      return res.status(404).json({ error: 'Item not found or unauthorized' });
    }

    // RULE 2: If isPerishable, expiryDate is MANDATORY
    if (item.isPerishable && !expirationDate) {
      return res.status(400).json({ error: 'Validation Error: Expiry date is MANDATORY for perishable goods batches.' });
    }

    const qty = parseInt(quantity, 10);
    const newBatch = await prisma.inventoryBatch.create({
      data: {
        batchId: batchId || `BATCH-${Date.now().toString().slice(-6)}`,
        quantity: qty,
        initialQuantity: qty,
        expirationDate: expirationDate ? new Date(expirationDate) : null,
        itemId: id,
        vendorId: req.user.vendorId
      }
    });

    res.status(201).json(newBatch);
  } catch (error) {
    console.error("Add batch error:", error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 4. QUICK SALE (BARCODE SCANNER)
// Scans barcode -> if exists: auto subtracts 1 via FIFO, logs SaleTransaction with timestamp, returns updated stock & item
app.post('/api/inventory/quick-scan-sale', authenticateToken, async (req, res) => {
  const { barcode } = req.body;

  if (!barcode || barcode.trim() === '') {
    return res.status(400).json({ error: 'Barcode is required.' });
  }

  const cleanBarcode = barcode.trim();

  try {
    const item = await prisma.inventoryItem.findFirst({
      where: { vendorId: req.user.vendorId, barcode: cleanBarcode },
      include: {
        batches: {
          where: { quantity: { gt: 0 } },
          orderBy: [
            { expirationDate: 'asc' }, // FEFO / FIFO
            { createdAt: 'asc' }
          ]
        }
      }
    });

    if (!item) {
      return res.status(404).json({
        found: false,
        barcode: cleanBarcode,
        message: `Barcode "${cleanBarcode}" is not registered in your inventory.`
      });
    }

    const totalAvailable = item.batches.reduce((sum, b) => sum + b.quantity, 0);
    if (totalAvailable < 1) {
      return res.status(400).json({
        found: true,
        item,
        error: `Out of stock! "${item.name}" has 0 remaining units.`
      });
    }

    // Deduct 1 unit from earliest expiring batch (FIFO / FEFO)
    const targetBatch = item.batches[0];
    const updatedBatch = await prisma.inventoryBatch.update({
      where: { id: targetBatch.id },
      data: { quantity: targetBatch.quantity - 1 }
    });

    // Record Quick Sale transaction in history
    const transaction = await prisma.saleTransaction.create({
      data: {
        type: 'Quick Sale (Barcode)',
        quantity: 1,
        barcode: cleanBarcode,
        itemId: item.id,
        batchId: targetBatch.id,
        vendorId: req.user.vendorId
      }
    });

    const newStock = totalAvailable - 1;
    const isLowStock = newStock <= item.minThreshold;

    res.json({
      found: true,
      success: true,
      item: {
        id: item.id,
        name: item.name,
        price: item.price,
        barcode: item.barcode,
        isPackaged: item.isPackaged,
        isPerishable: item.isPerishable,
        minThreshold: item.minThreshold
      },
      deductedBatch: {
        batchId: targetBatch.batchId,
        expirationDate: targetBatch.expirationDate,
        remainingInBatch: updatedBatch.quantity
      },
      stockRemaining: newStock,
      isLowStock,
      transactionId: transaction.id,
      timestamp: transaction.createdAt,
      message: `Sold! Stock remaining: ${newStock}`
    });
  } catch (error) {
    console.error("Quick scan sale error:", error);
    res.status(500).json({ error: 'Internal server error during quick scan sale' });
  }
});

// 5. MANUAL SALE DEDUCTION (For Raw / Loose Items using FEFO or Specific Batch)
app.post('/api/inventory/:id/deduct', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { quantity, batchId, reason } = req.body;

  const deductQty = parseInt(quantity, 10) || 1;
  if (deductQty <= 0) {
    return res.status(400).json({ error: 'Valid positive quantity is required.' });
  }

  try {
    const item = await prisma.inventoryItem.findFirst({
      where: { id, vendorId: req.user.vendorId },
      include: {
        batches: {
          where: { quantity: { gt: 0 } },
          orderBy: [
            { expirationDate: 'asc' }, // FEFO / FIFO
            { createdAt: 'asc' }
          ]
        }
      }
    });

    if (!item) {
      return res.status(404).json({ error: 'Item not found or unauthorized' });
    }

    // If a specific batchId is provided for manual selection
    if (batchId) {
      const specificBatch = item.batches.find(b => b.id === batchId || b.batchId === batchId);
      if (!specificBatch) {
        return res.status(404).json({ error: 'Selected batch not found or out of stock.' });
      }
      if (specificBatch.quantity < deductQty) {
        return res.status(400).json({ error: `Selected batch only has ${specificBatch.quantity} unit(s) available.` });
      }

      const updatedBatch = await prisma.inventoryBatch.update({
        where: { id: specificBatch.id },
        data: { quantity: specificBatch.quantity - deductQty }
      });

      const transaction = await prisma.saleTransaction.create({
        data: {
          type: reason || 'Manual Sale',
          quantity: deductQty,
          barcode: item.barcode,
          itemId: item.id,
          batchId: specificBatch.id,
          vendorId: req.user.vendorId
        }
      });

      const totalRemaining = item.batches.reduce((sum, b) => sum + (b.id === specificBatch.id ? updatedBatch.quantity : b.quantity), 0);

      return res.json({
        message: `Successfully sold ${deductQty} unit(s) of "${item.name}".`,
        item: { id: item.id, name: item.name, price: item.price },
        deductions: [{
          batchId: specificBatch.batchId,
          expirationDate: specificBatch.expirationDate,
          deducted: deductQty,
          remainingInBatch: updatedBatch.quantity
        }],
        totalStockRemaining: totalRemaining,
        minThreshold: item.minThreshold,
        isLowStock: totalRemaining <= item.minThreshold,
        transactionId: transaction.id,
        timestamp: transaction.createdAt
      });
    }

    // Standard FIFO / FEFO across batches
    const totalAvailable = item.batches.reduce((sum, b) => sum + b.quantity, 0);
    if (deductQty > totalAvailable) {
      return res.status(400).json({
        error: `Insufficient stock. Requested ${deductQty}, but only ${totalAvailable} units are available.`
      });
    }

    let remainingToDeduct = deductQty;
    const deductions = [];
    let lastBatchId = null;

    for (const batch of item.batches) {
      if (remainingToDeduct <= 0) break;

      const take = Math.min(batch.quantity, remainingToDeduct);
      const updatedBatch = await prisma.inventoryBatch.update({
        where: { id: batch.id },
        data: { quantity: batch.quantity - take }
      });

      lastBatchId = batch.id;
      deductions.push({
        batchId: batch.batchId,
        expirationDate: batch.expirationDate,
        deducted: take,
        remainingInBatch: updatedBatch.quantity
      });

      remainingToDeduct -= take;
    }

    const transaction = await prisma.saleTransaction.create({
      data: {
        type: reason || 'Quick Sale / Manual FIFO',
        quantity: deductQty,
        barcode: item.barcode,
        itemId: item.id,
        batchId: lastBatchId,
        vendorId: req.user.vendorId
      }
    });

    const newTotalStock = totalAvailable - deductQty;
    const isLowStock = newTotalStock <= item.minThreshold;

    res.json({
      message: `Sold! Stock remaining: ${newTotalStock}`,
      item: { id: item.id, name: item.name, price: item.price },
      deductions,
      totalStockRemaining: newTotalStock,
      minThreshold: item.minThreshold,
      isLowStock,
      transactionId: transaction.id,
      timestamp: transaction.createdAt
    });
  } catch (error) {
    console.error("Deduction error:", error);
    res.status(500).json({ error: 'Internal server error during deduction' });
  }
});

// 5b. BULK ISSUE / TRADER BILL OUTGOING DEDUCTION (PRISMA TRANSACTION + FEFO)
app.post('/api/inventory/bulk-issue', authenticateToken, async (req, res) => {
  const { items, invoiceNumber } = req.body; // array of { productId, quantity }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one item is required in the bulk transaction list.' });
  }

  // Validate request structure
  for (let idx = 0; idx < items.length; idx++) {
    const entry = items[idx];
    const qty = parseInt(entry.quantity, 10);
    if (!entry.productId) {
      return res.status(400).json({ error: `Item at position ${idx + 1} is missing productId.` });
    }
    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: `Invalid quantity "${entry.quantity}" for item at position ${idx + 1}.` });
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const processedResults = [];
      const now = new Date();

      for (const entry of items) {
        const reqQty = parseInt(entry.quantity, 10);
        
        // Fetch product with all active batches in FEFO order (expirationDate asc, createdAt asc)
        const product = await tx.inventoryItem.findFirst({
          where: { id: entry.productId, vendorId: req.user.vendorId },
          include: {
            batches: {
              where: { quantity: { gt: 0 } },
              orderBy: [
                { expirationDate: 'asc' },
                { createdAt: 'asc' }
              ]
            }
          }
        });

        if (!product) {
          throw new Error(`Product not found or unauthorized (ID: ${entry.productId}).`);
        }

        const totalAvailable = product.batches.reduce((sum, b) => sum + b.quantity, 0);
        if (reqQty > totalAvailable) {
          throw new Error(`Insufficient stock for "${product.name}". Requested: ${reqQty}, Available: ${totalAvailable}.`);
        }

        let remainingToDeduct = reqQty;
        const itemDeductions = [];
        let lastBatchId = null;

        for (const batch of product.batches) {
          if (remainingToDeduct <= 0) break;

          const take = Math.min(batch.quantity, remainingToDeduct);
          const updatedBatch = await tx.inventoryBatch.update({
            where: { id: batch.id },
            data: { quantity: batch.quantity - take }
          });

          lastBatchId = batch.id;
          itemDeductions.push({
            batchId: batch.batchId,
            expirationDate: batch.expirationDate,
            deducted: take,
            remainingInBatch: updatedBatch.quantity
          });

          remainingToDeduct -= take;
        }

        // Record Sale Transaction
        const transaction = await tx.saleTransaction.create({
          data: {
            type: invoiceNumber ? `Trader Bill (${invoiceNumber})` : 'Rapid Bulk Issue',
            quantity: reqQty,
            barcode: product.barcode,
            itemId: product.id,
            batchId: lastBatchId,
            vendorId: req.user.vendorId
          }
        });

        const newStock = totalAvailable - reqQty;
        processedResults.push({
          productId: product.id,
          productName: product.name,
          price: product.price,
          quantityDeducted: reqQty,
          stockRemaining: newStock,
          isLowStock: newStock <= product.minThreshold,
          deductions: itemDeductions,
          transactionId: transaction.id
        });
      }

      return processedResults;
    });

    res.json({
      success: true,
      message: `Successfully processed ${result.length} item(s) from Trader Bill.`,
      itemsProcessed: result.length,
      totalUnitsDeducted: result.reduce((sum, r) => sum + r.quantityDeducted, 0),
      totalBillValue: result.reduce((sum, r) => sum + (r.price * r.quantityDeducted), 0),
      results: result
    });
  } catch (error) {
    console.error("Bulk issue transaction failed:", error.message);
    res.status(400).json({ error: error.message || 'Failed to process bulk issue transaction.' });
  }
});

// 6. GET SALES HISTORY TRANSACTIONS
app.get('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const transactions = await prisma.saleTransaction.findMany({
      where: { vendorId: req.user.vendorId },
      include: {
        item: true,
        batch: true
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json(transactions);
  } catch (error) {
    console.error("Get transactions error:", error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 7. DELETE ITEM
app.delete('/api/inventory/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const item = await prisma.inventoryItem.findFirst({
      where: { id, vendorId: req.user.vendorId }
    });
    if (!item) return res.status(404).json({ error: 'Item not found or unauthorized' });

    await prisma.inventoryItem.delete({ where: { id } });
    res.json({ message: 'Item and all associated batches deleted successfully' });
  } catch (error) {
    console.error("Delete item error:", error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
