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

// --- INVENTORY ROUTES (Protected, Multi-tenant) ---

// 1. GET ALL ITEMS (With Lead-Time Guard status & Batches for FIFO)
app.get('/api/inventory', authenticateToken, async (req, res) => {
  try {
    const items = await prisma.inventoryItem.findMany({
      where: { vendorId: req.user.vendorId },
      include: {
        batches: {
          orderBy: { expirationDate: 'asc' } // ordered for FIFO preview
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const now = new Date();

    const formattedItems = items.map(item => {
      const activeBatches = item.batches.filter(b => b.quantity > 0);
      const totalStock = activeBatches.reduce((sum, b) => sum + b.quantity, 0);
      const isLowStock = totalStock <= item.minThreshold;
      const expiredBatchesCount = item.batches.filter(b => new Date(b.expirationDate) < now && b.quantity > 0).length;

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

// 2. CREATE ITEM (With initial batch & Lead-Time Threshold)
app.post('/api/inventory', authenticateToken, async (req, res) => {
  const { name, price, minThreshold, batchId, quantity, expirationDate } = req.body;
  
  if (!name || price === undefined) {
    return res.status(400).json({ error: 'Item name and price are required.' });
  }

  try {
    const thresholdVal = minThreshold !== undefined ? parseInt(minThreshold, 10) : 5;
    const initialQty = parseInt(quantity, 10) || 0;

    const newItem = await prisma.inventoryItem.create({
      data: {
        name,
        price: parseFloat(price),
        minThreshold: thresholdVal,
        vendorId: req.user.vendorId,
        ...(initialQty > 0 ? {
          batches: {
            create: {
              batchId: batchId || `BATCH-${Date.now().toString().slice(-6)}`,
              quantity: initialQty,
              initialQuantity: initialQty,
              expirationDate: expirationDate ? new Date(expirationDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // default 30 days
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 3. ADD BATCH TO ITEM (Perishable Guard Entry)
app.post('/api/inventory/:id/batches', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { batchId, quantity, expirationDate } = req.body;

  if (!quantity || parseInt(quantity, 10) <= 0) {
    return res.status(400).json({ error: 'Valid positive quantity is required.' });
  }

  if (!expirationDate) {
    return res.status(400).json({ error: 'Expiration date is required for batch inventory tracking.' });
  }

  try {
    const item = await prisma.inventoryItem.findFirst({
      where: { id, vendorId: req.user.vendorId }
    });

    if (!item) {
      return res.status(404).json({ error: 'Item not found or unauthorized' });
    }

    const qty = parseInt(quantity, 10);
    const newBatch = await prisma.inventoryBatch.create({
      data: {
        batchId: batchId || `BATCH-${Date.now().toString().slice(-6)}`,
        quantity: qty,
        initialQuantity: qty,
        expirationDate: new Date(expirationDate),
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

// 4. PERISHABLE GUARD: FIFO STOCK DEDUCTION
// Deducts stock strictly starting with earliest expiration date
app.post('/api/inventory/:id/deduct', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { quantity, reason } = req.body;

  const deductQty = parseInt(quantity, 10);
  if (!deductQty || deductQty <= 0) {
    return res.status(400).json({ error: 'Valid positive quantity to deduct is required.' });
  }

  try {
    const item = await prisma.inventoryItem.findFirst({
      where: { id, vendorId: req.user.vendorId },
      include: {
        batches: {
          where: { quantity: { gt: 0 } },
          orderBy: { expirationDate: 'asc' } // FIRST-IN, FIRST-OUT strictly by earliest expiry
        }
      }
    });

    if (!item) {
      return res.status(404).json({ error: 'Item not found or unauthorized' });
    }

    const totalAvailable = item.batches.reduce((sum, b) => sum + b.quantity, 0);
    if (deductQty > totalAvailable) {
      return res.status(400).json({
        error: `Insufficient stock. Requested ${deductQty}, but only ${totalAvailable} units are available across all batches.`
      });
    }

    let remainingToDeduct = deductQty;
    const deductions = [];

    // Execute FIFO transactions
    for (const batch of item.batches) {
      if (remainingToDeduct <= 0) break;

      const take = Math.min(batch.quantity, remainingToDeduct);
      const updatedBatch = await prisma.inventoryBatch.update({
        where: { id: batch.id },
        data: { quantity: batch.quantity - take }
      });

      deductions.push({
        batchId: batch.batchId,
        expirationDate: batch.expirationDate,
        deducted: take,
        remainingInBatch: updatedBatch.quantity
      });

      remainingToDeduct -= take;
    }

    const newTotalStock = totalAvailable - deductQty;
    const isLowStock = newTotalStock <= item.minThreshold;

    res.json({
      message: `Successfully deducted ${deductQty} unit(s) using FIFO logic based on expiry date.`,
      reason: reason || 'Sale / Consumption',
      deductions,
      totalStockRemaining: newTotalStock,
      minThreshold: item.minThreshold,
      leadTimeAlert: isLowStock ? `⚠️ Low stock warning! Stock (${newTotalStock}) <= minimum threshold (${item.minThreshold}).` : null
    });
  } catch (error) {
    console.error("FIFO deduction error:", error);
    res.status(500).json({ error: 'Internal server error during FIFO deduction' });
  }
});

// 5. UPDATE ITEM (Name, Price, Minimum Threshold)
app.put('/api/inventory/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, price, minThreshold } = req.body;

  try {
    const item = await prisma.inventoryItem.findFirst({
      where: { id, vendorId: req.user.vendorId }
    });
    if (!item) return res.status(404).json({ error: 'Item not found or unauthorized' });

    const updatedItem = await prisma.inventoryItem.update({
      where: { id },
      data: {
        name: name !== undefined ? name : item.name,
        price: price !== undefined ? parseFloat(price) : item.price,
        minThreshold: minThreshold !== undefined ? parseInt(minThreshold, 10) : item.minThreshold
      },
      include: {
        batches: true
      }
    });

    res.json(updatedItem);
  } catch (error) {
    console.error("Update item error:", error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 6. DELETE ITEM
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
