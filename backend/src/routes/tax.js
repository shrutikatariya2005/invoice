const router = require('express').Router();
const db     = require('../../db');

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM tax
       WHERE is_active = 1
       ORDER BY (cgst_rate + sgst_rate) ASC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM tax WHERE tax_id = ?',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Tax slab not found' });
    }
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const {
      tax_name,
      cgst_rate = 0,
      sgst_rate = 0,
      igst_rate = 0
    } = req.body;

    if (!tax_name) {
      return res.status(400).json({ error: 'tax_name is required' });
    }

    const [result] = await db.query(
      `INSERT INTO tax (tax_name, cgst_rate, sgst_rate, igst_rate)
       VALUES (?, ?, ?, ?)`,
      [tax_name, cgst_rate, sgst_rate, igst_rate]
    );

    res.status(201).json({
      message: 'Tax slab created',
      tax_id:  result.insertId
    });
  } catch (err) { next(err); }
});

module.exports = router;