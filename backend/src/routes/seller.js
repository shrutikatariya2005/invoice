const router = require('express').Router();
const db     = require('../../db');

// GET /api/seller
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM seller WHERE seller_id = 1'
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Company details not found' });
    }
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/seller
router.put('/', async (req, res, next) => {
  try {
    const {
      name, legal_name, address, city, state,
      pincode, gstin, pan, phone, email,
      bank_name, bank_account, ifsc_code,
      upi_id, state_code
    } = req.body;

    if (!name || !gstin) {
      return res.status(400).json({
        error: 'name and gstin are required'
      });
    }

    await db.query(
      `UPDATE seller SET
        name         = ?,
        legal_name   = ?,
        address      = ?,
        city         = ?,
        state        = ?,
        pincode      = ?,
        gstin        = ?,
        pan          = ?,
        phone        = ?,
        email        = ?,
        bank_name    = ?,
        bank_account = ?,
        ifsc_code    = ?,
        upi_id       = ?,
        state_code   = ?
       WHERE seller_id = 1`,
      [
        name, legal_name, address, city, state,
        pincode, gstin, pan, phone, email,
        bank_name, bank_account, ifsc_code,
        upi_id, state_code
      ]
    );

    res.json({ message: 'Company details updated successfully' });
  } catch (err) { next(err); }
});

module.exports = router;