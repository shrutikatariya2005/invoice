const router = require('express').Router();
const db = require('../../db');

// Helper: Auto-generate invoice number INV-2026-0001
async function generateInvoiceNumber(conn) {
  const year = new Date().getFullYear();
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS total FROM invoice
     WHERE YEAR(invoice_date) = ?`,
    [year]
  );
  const count = rows[0].total + 1;
  return `INV-${year}-${String(count).padStart(4, '0')}`;
}

// Helper: Calculate each line item amounts
function calculateItem(item) {
  const qty = parseFloat(item.quantity) || 0;
  const rate = parseFloat(item.rate) || 0;
  const discPct = parseFloat(item.discount_pct) || 0;
  const cgstRate = parseFloat(item.cgst_rate) || 0;
  const sgstRate = parseFloat(item.sgst_rate) || 0;

  const gross = qty * rate;
  const discAmt = gross * discPct / 100;
  const taxable_amount = gross - discAmt;
  const cgstAmt = taxable_amount * cgstRate / 100;
  const sgstAmt = taxable_amount * sgstRate / 100;
  const tax_amount = cgstAmt + sgstAmt;
  const total_amount = taxable_amount + tax_amount;

  return {
    ...item,
    taxable_amount: parseFloat(taxable_amount.toFixed(2)),
    tax_amount: parseFloat(tax_amount.toFixed(2)),
    total_amount: parseFloat(total_amount.toFixed(2))
  };
}

// GET /api/invoice
router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT
        i.invoice_id,
        i.invoice_number,
        i.invoice_date,
        i.due_date,
        i.grand_total,
        i.balance_due,
        i.amount_paid,
        i.status,
        i.created_at,
        c.name     AS client_name,
        c.gstin    AS client_gstin
      FROM invoice i
      JOIN client c ON c.client_id = i.client_id
    `;

    const params = [];
    if (status) {
      query += ' WHERE i.status = ?';
      params.push(status);
    }
    query += ' ORDER BY i.invoice_date DESC';

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/invoice/:id
router.get('/:id', async (req, res, next) => {
  try {
    // Invoice + client details
    const [invoices] = await db.query(
      `SELECT
         i.*,
         c.name         AS client_name,
         c.legal_name   AS client_legal_name,
         c.address      AS client_address,
         c.city         AS client_city,
         c.state        AS client_state,
         c.pincode      AS client_pincode,
         c.gstin        AS client_gstin,
         c.phone        AS client_phone,
         c.email        AS client_email
       FROM invoice i
       JOIN client c ON c.client_id = i.client_id
       WHERE i.invoice_id = ?`,
      [req.params.id]
    );

    if (invoices.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Line items
    const [items] = await db.query(
      `SELECT
         ii.*,
         t.tax_name,
         t.cgst_rate,
         t.sgst_rate
       FROM invoice_item ii
       LEFT JOIN tax t ON t.tax_id = ii.tax_id
       WHERE ii.invoice_id = ?
       ORDER BY ii.sort_order ASC`,
      [req.params.id]
    );

    // Seller for PDF
    const [seller] = await db.query(
      'SELECT * FROM seller WHERE seller_id = 1'
    );

    // Payments
    const [payments] = await db.query(
      'SELECT * FROM payment WHERE invoice_id = ? ORDER BY payment_date ASC',
      [req.params.id]
    );

    res.json({
      invoice: invoices[0],
      items: items,
      seller: seller[0] || {},
      payments: payments
    });
  } catch (err) { next(err); }
});

// POST /api/invoice
router.post('/', async (req, res, next) => {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const {
      client_id,
      invoice_date,
      due_date,
      discount_amount = 0,
      items
    } = req.body;

    // Validate
    if (!client_id || !invoice_date || !due_date) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({
        error: 'client_id, invoice_date and due_date are required'
      });
    }

    if (!items || items.length === 0) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({
        error: 'At least one item is required'
      });
    }

    // Calculate all items
    const calculatedItems = items.map(calculateItem);

    // Invoice totals
    const subtotal = parseFloat(
      calculatedItems.reduce(
        (sum, i) => sum + (i.quantity * i.rate), 0
      ).toFixed(2)
    );

    const taxable_amount = parseFloat(
      (subtotal - discount_amount).toFixed(2)
    );

    const tax_amount = parseFloat(
      calculatedItems.reduce(
        (sum, i) => sum + i.tax_amount, 0
      ).toFixed(2)
    );

    const grand_total = parseFloat(
      (taxable_amount + tax_amount).toFixed(2)
    );

    // Generate invoice number
    const invoiceNumber = await generateInvoiceNumber(conn);

    // STEP 1 — Insert invoice header
    const [invResult] = await conn.query(
      `INSERT INTO invoice (
         client_id,
         invoice_number,
         invoice_date,
         due_date,
         subtotal,
         discount_amount,
         taxable_amount,
         tax_amount,
         grand_total,
         status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')`,
      [
        client_id,
        invoiceNumber,
        invoice_date,
        due_date,
        subtotal,
        parseFloat(discount_amount),
        taxable_amount,
        tax_amount,
        grand_total
      ]
    );

    const invoiceId = invResult.insertId;

    // STEP 2 — Insert each line item
    for (let i = 0; i < calculatedItems.length; i++) {
      const item = calculatedItems[i];

      await conn.query(
        `INSERT INTO invoice_item (
           invoice_id,
           product_id,
           item_name,
           hsn_sac_code,
           quantity,
           unit,
           rate,
           discount_pct,
           taxable_amount,
           tax_id,
           tax_amount,
           total_amount,
           sort_order
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoiceId,
          item.product_id || null,
          item.item_name,
          item.hsn_sac_code,
          item.quantity,
          item.unit || 'Nos',
          item.rate,
          item.discount_pct || 0,
          item.taxable_amount,
          item.tax_id || null,
          item.tax_amount,
          item.total_amount,
          i + 1
        ]
      );
    }

    await conn.commit();

    res.status(201).json({
      message: 'Invoice created successfully',
      invoice_id: invoiceId,
      invoice_number: invoiceNumber,
      grand_total: grand_total
    });

  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// PATCH /api/invoice/:id/status
router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    const allowed = ['DRAFT', 'SENT', 'PAID', 'PARTIAL', 'OVERDUE', 'CANCELLED'];

    if (!allowed.includes(status)) {
      return res.status(400).json({
        error: `Status must be one of: ${allowed.join(', ')}`
      });
    }

    const [result] = await db.query(
      'UPDATE invoice SET status = ? WHERE invoice_id = ?',
      [status, req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json({ message: `Invoice marked as ${status}` });
  } catch (err) { next(err); }
});

// DELETE /api/invoice/:id  (DRAFT only)
router.delete('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT status FROM invoice WHERE invoice_id = ?',
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (rows[0].status !== 'DRAFT') {
      return res.status(400).json({
        error: `Only DRAFT invoices can be deleted. This is ${rows[0].status}.`
      });
    }

    await db.query(
      'DELETE FROM invoice WHERE invoice_id = ?',
      [req.params.id]
    );

    res.json({ message: 'Invoice deleted successfully' });
  } catch (err) { next(err); }
});
// PUT /api/invoice/:id (Update an existing invoice)
router.put('/:id', async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { client_id, invoice_date, due_date, discount_amount = 0, items } = req.body;
    const invoiceId = req.params.id;

    // 1. Calculate totals
    const calculatedItems = items.map(calculateItem);
    const subtotal = parseFloat(calculatedItems.reduce((sum, i) => sum + (i.quantity * i.rate), 0).toFixed(2));
    const taxable_amount = parseFloat((subtotal - discount_amount).toFixed(2));
    const tax_amount = parseFloat(calculatedItems.reduce((sum, i) => sum + i.tax_amount, 0).toFixed(2));
    const grand_total = parseFloat((taxable_amount + tax_amount).toFixed(2));

    // 2. Update Header
    await conn.query(
      `UPDATE invoice SET client_id=?, invoice_date=?, due_date=?, subtotal=?, discount_amount=?, taxable_amount=?, tax_amount=?, grand_total=? WHERE invoice_id=?`,
      [client_id, invoice_date, due_date, subtotal, parseFloat(discount_amount), taxable_amount, tax_amount, grand_total, invoiceId]
    );

    // 3. Delete old items & Insert new items
    await conn.query(`DELETE FROM invoice_item WHERE invoice_id=?`, [invoiceId]);
    for (let i = 0; i < calculatedItems.length; i++) {
      const item = calculatedItems[i];
      await conn.query(
        `INSERT INTO invoice_item (invoice_id, product_id, item_name, hsn_sac_code, quantity, unit, rate, discount_pct, taxable_amount, tax_id, tax_amount, total_amount, sort_order) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [invoiceId, item.product_id || null, item.item_name, item.hsn_sac_code, item.quantity, item.unit || 'Nos', item.rate, item.discount_pct || 0, item.taxable_amount, item.tax_id || null, item.tax_amount, item.total_amount, i + 1]
      );
    }

    await conn.commit();
    res.json({ message: 'Invoice updated successfully', invoice_id: invoiceId });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

module.exports = router;