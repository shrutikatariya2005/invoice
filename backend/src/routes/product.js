const router = require('express').Router();
const db     = require('../../db');

// GET /api/product
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT
         p.product_id,
         p.name,
         p.description,
         p.hsn_sac_code,
         p.unit,
         p.rate,
         p.tax_id,
         t.tax_name,
         t.cgst_rate,
         t.sgst_rate,
         t.igst_rate
       FROM product p
       LEFT JOIN tax t ON t.tax_id = p.tax_id
       WHERE p.is_active = 1
       AND p.seller_id = 1
       ORDER BY p.name ASC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/product/:id
router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT p.*, t.tax_name, t.cgst_rate, t.sgst_rate, t.igst_rate
       FROM product p
       LEFT JOIN tax t ON t.tax_id = p.tax_id
       WHERE p.product_id = ? AND p.is_active = 1`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// POST /api/product
router.post('/', async (req, res, next) => {
  try {
    const {
      name,
      description,
      hsn_sac_code,
      unit  = 'Nos',
      rate,
      tax_id
    } = req.body;

    if (!name || !hsn_sac_code || rate === undefined) {
      return res.status(400).json({
        error: 'name, hsn_sac_code and rate are required'
      });
    }

    const [result] = await db.query(
      `INSERT INTO product (
         seller_id,
         name,
         description,
         hsn_sac_code,
         unit,
         rate,
         tax_id
       ) VALUES (1, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        description  || null,
        hsn_sac_code,
        unit,
        rate,
        tax_id       || null
      ]
    );

    res.status(201).json({
      message:    'Product created successfully',
      product_id: result.insertId
    });
  } catch (err) { next(err); }
});

// PUT /api/product/:id
router.put('/:id', async (req, res, next) => {
  try {
    const {
      name, description, hsn_sac_code,
      unit, rate, tax_id
    } = req.body;

    if (!name || !hsn_sac_code || rate === undefined) {
      return res.status(400).json({
        error: 'name, hsn_sac_code and rate are required'
      });
    }

    const [result] = await db.query(
      `UPDATE product SET
         name         = ?,
         description  = ?,
         hsn_sac_code = ?,
         unit         = ?,
         rate         = ?,
         tax_id       = ?
       WHERE product_id = ? AND is_active = 1`,
      [
        name, description || null, hsn_sac_code,
        unit || 'Nos', rate, tax_id || null,
        req.params.id
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ message: 'Product updated successfully' });
  } catch (err) { next(err); }
});

// DELETE /api/product/:id  (soft delete)
router.delete('/:id', async (req, res, next) => {
  try {
    const [result] = await db.query(
      `UPDATE product SET
         is_active  = 0,
         deleted_at = NOW()
       WHERE product_id = ? AND is_active = 1`,
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ message: 'Product deleted successfully' });
  } catch (err) { next(err); }
});

module.exports = router;