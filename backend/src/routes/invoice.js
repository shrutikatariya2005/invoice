const router = require('express').Router();
const db = require('../../db');
const { requireFields } = require('../middleware/validate');

// Helper: Auto-generate invoice number INV-2026-0001
async function generateInvoiceNumber(conn) {
  const year = new Date().getFullYear();
  const [rows] = await conn.query(
    `SELECT MAX(CAST(SUBSTRING_INDEX(invoice_number, '-', -1) AS UNSIGNED)) AS max_num
     FROM invoice WHERE invoice_number LIKE ?`,
    [`INV-${year}-%`]
  );
  const maxNum = rows[0].max_num || 0;
  return `INV-${year}-${String(maxNum + 1).padStart(4, '0')}`;
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
        i.client_id,
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
// GET /api/invoice/report/client-items
router.get('/report/master', async (req, res, next) => {
  try {


    const { filter, status, search, startDate, endDate } = req.query;
    // build where claus based on the filter
    let whereClause = '';
    const params = [];


    if (filter === 'THIS_WEEK') {
      whereClause = ` WHERE DATE(i.invoice_date) >=
      CURDATE()-INTERVAL(DAYOFWEEK(CURDATE())%7+7) DAY
      AND DATE(i.invoice_date) <= CURDATE()
      AND DAYOFWEEK(i.invoice_date) !=1`;
    }

    else if (filter && filter.startsWith('LAST_X_DAYS:')) {
      const days = parseInt(filter.split(':')[1]) || 7;

      whereClause = ` WHERE DATE(i.invoice_date) >= CURDATE() - INTERVAL ? DAY AND DATE(i.invoice_date) <= CURDATE()`;
      params.push(days - 1);
    }

    else if (filter && filter.startsWith('LAST_X_WEEKS:')) {
      const weeks = parseInt(filter.split(':')[1]) || 4;
      const days = weeks * 7;
      whereClause = ` WHERE DATE(i.invoice_date) >= CURDATE() - INTERVAL ? DAY AND DATE(i.invoice_date) <= CURDATE() + INTERVAL 7 DAY`;
      params.push(days - 1);
    }
    else if (filter === 'MONTHLY') {
      whereClause = `WHERE YEAR(i.invoice_date) = YEAR(CURDATE())`
    }
    else if (filter && filter.match(/^\d{4}-\d{2}$/)) {
      //if user sends a specific month like "2026-06"
      //fetch that month AND the previous month for the chart
      whereClause = ` WHERE i.invoice_date >= LAST_DAY('${filter}-01' - INTERVAL 2 MONTH) + INTERVAL 1 DAY 
                      AND i.invoice_date <= LAST_DAY('${filter}-01')`;
    }

    // status filter
    if (status && status !== 'ALL') {
      whereClause += (whereClause ? ' AND ' : ' WHERE ') +
        ' i.status = ? ';
      params.push(status);
    }

    if (search) {
      whereClause += (whereClause ? ' AND ' : ' WHERE ') + ' (i.invoice_number LIKE ? OR c.name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    //Custom date range filter for clicked weeks
    if (startDate && endDate) {
      whereClause += (whereClause ? ' AND ' : ' WHERE ') + ' DATE(i.invoice_date) >= ? AND DATE(i.invoice_date)<= ? ';
      params.push(startDate, endDate);

    }
    //if no filter returns all invoices

    const [rows] =
      await db.query(`
      SELECT 
     i.invoice_id,
     i.invoice_number,
     i.invoice_date,
     i.due_date,
     i.status,
     i.grand_total,
     i.balance_due,
     c.name AS client_name,
     c.phone AS client_phone,
     c.email AS client_email,
     (SELECT COUNT(*) FROM invoice
      where client_id=c.client_id) AS total_invoices
     FROM invoice i
     JOIN client c ON i.client_id = c.client_id
     ${whereClause}
     ORDER BY i.invoice_date DESC

    `, params);
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

    {/* for (const item of items) {
      if (item.product_id) {
        const [prodRows] = await conn.query('SELECT current_stock, name FROM product WHERE product_id = ? FOR UPDATE',
          [item.product_id]);
        if (prodRows.length === 0) {
          await conn.rollback();
          conn.release();
          return res.status(400).json({ error: `Product not found: ${item.item_name})` });
        }

        if (prodRows[0].current_stock < item.quantity) {

          await conn.rollback();
          conn.release();
          return res.status(400).json({
            error: `Not enough stock for ${prodRows[0].name}.Available: ${prodRows[0].current_stock} 
              Requested: ${item.quantity}`
          });
        }
      }
    } */}
    // Calculate all items
    // Fetch all tax rates from the database
    const taxIds = [...new Set(items.map(i => i.tax_id).filter(Boolean))];
    let taxMap = {};
    if (taxIds.length > 0) {
      const [taxRows] = await conn.query(
        `SELECT tax_id, cgst_rate, sgst_rate FROM tax WHERE tax_id IN (${taxIds.map(() => '?').join(',')})`,
        taxIds
      );
      taxRows.forEach(t => { taxMap[t.tax_id] = t; });
    }

    // Enrich items with actual tax rates before calculating
    const enrichedItems = items.map(item => ({
      ...item,
      cgst_rate: taxMap[item.tax_id]?.cgst_rate || 0,
      sgst_rate: taxMap[item.tax_id]?.sgst_rate || 0,
    }));
    const calculatedItems = enrichedItems.map(calculateItem);

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
      {/* //---NEW: DEDUCT stock & log movement
      if (item.product_id) {
        await conn.query(
          `UPDATE product SET current_stock = current_stock -? WHERE product_id =? `,
          [item.quantity, item.product_id]
        );

        await conn.query(
          `INSERT INTO inventory_movement(product_id,
          quantity_change , movement_type, refrence_id)
          VALUES (?,?,'INVOICE_SALE',?)`,
          [item.product_id, -item.quantity, invoiceId]
        )
      }*/}
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

// DELETE /api/invoice/:id  (deletes any invoice + its items)
router.delete('/:id', async (req, res, next) => {
  try {
    // Step 1 — check invoice exists
    const [rows] = await db.query(
      'SELECT invoice_id, status FROM invoice WHERE invoice_id = ?',
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Step 2 — delete line items first (foreign key constraint)
    await db.query(
      'DELETE FROM invoice_item WHERE invoice_id = ?',
      [req.params.id]
    );

    // Step 3 — delete the invoice
    await db.query(
      'DELETE FROM invoice WHERE invoice_id = ?',
      [req.params.id]
    );

    res.json({
      message: 'Invoice deleted successfully',
      invoice_id: parseInt(req.params.id)
    });
  } catch (err) { next(err); }
});
// PUT /api/invoice/:id (Update an existing invoice)
router.put(
  '/:id',
  requireFields(['client_id', 'invoice_date', 'due_date', 'items', 'discount_amount', 'status']),
  async (req, res, next) => {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const { client_id, invoice_date, due_date, discount_amount = 0, items, status } = req.body;
      const invoiceId = req.params.id;

      // 1. Check invoice exists
      const [existing] = await conn.query(
        'SELECT invoice_id FROM invoice WHERE invoice_id = ?',
        [invoiceId]
      );
      if (existing.length === 0) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ error: 'Invoice not found' });
      }

      // 2. Validate items array is not empty
      if (!Array.isArray(items) || items.length === 0) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: 'At least one item is required' });
      }

      // 3. Calculate totals
      const calculatedItems = items.map(calculateItem);
      const subtotal = parseFloat(
        calculatedItems.reduce((sum, i) => sum + (i.quantity * i.rate), 0).toFixed(2)
      );
      const taxable_amount = parseFloat((subtotal - discount_amount).toFixed(2));
      const tax_amount = parseFloat(
        calculatedItems.reduce((sum, i) => sum + i.tax_amount, 0).toFixed(2)
      );
      const grand_total = parseFloat((taxable_amount + tax_amount).toFixed(2));

      // 4. Update invoice header
      await conn.query(
        `UPDATE invoice SET
           client_id       = ?,
           invoice_date    = ?,
           due_date        = ?,
           subtotal        = ?,
           discount_amount = ?,
           taxable_amount  = ?,
           tax_amount      = ?,
           grand_total     = ?,
           status = ?
         WHERE invoice_id = ?`,
        [client_id, invoice_date, due_date, subtotal,
          parseFloat(discount_amount), taxable_amount, tax_amount,
          grand_total, status || 'DRAFT', invoiceId]
      );

      // 5. Delete old line items and insert new ones
      await conn.query('DELETE FROM invoice_item WHERE invoice_id = ?', [invoiceId]);

      for (let i = 0; i < calculatedItems.length; i++) {
        const item = calculatedItems[i];
        await conn.query(
          `INSERT INTO invoice_item (
             invoice_id, product_id, item_name, hsn_sac_code,
             quantity, unit, rate, discount_pct,
             taxable_amount, tax_id, tax_amount, total_amount, sort_order
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
      res.json({
        message: 'Invoice updated successfully',
        invoice_id: parseInt(invoiceId),
        grand_total: grand_total
      });
    } catch (err) {
      await conn.rollback();
      next(err);
    } finally {
      conn.release();
    }
  }
);

{/*//GET/api/product/report/sales
router.get('/report/sales', async (req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT 
      p.name AS product_name,
      p.created_at AS creation_date,
      t.tax_name AS product_gst,
      COALESCE(sum(ii.quantity),0) AS total_qty_sold,
      COALESCE(sum(ii.total_amount),0) AS total_revenue
      FROM product p
      LEFT JOIN tax t ON p.tax_id =t.tax_id
      LEFT JOIN invoice_item ii ON p.product_id =ii.product_id
      WHERE p.is_active =1 AND p.seller_id =1
      GROUP BY p.product_id , p.name , p.created_at , t.tax_name
    ORDER BY total_revenue DESC
    `);
    res.json(rows);
  } catch (err) { next(err); }
});
*/}
module.exports = router;