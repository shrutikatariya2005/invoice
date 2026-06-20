const router = require('express').Router();
const db = require('../../db');
const { requireFields } = require('../middleware/validate');
// GET /api/client
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT *
       FROM client
       WHERE is_active = 1
       ORDER BY name ASC`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/client/:id
router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM client WHERE client_id = ? AND is_active = 1',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// POST /api/client
router.post('/', requireFields(['name']), async (req, res, next) => {
  try {
    const {
      name,
      legal_name,
      address,
      city,
      state,
      pincode,
      gstin,
      pan,
      phone,
      email
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const [result] = await db.query(
      `INSERT INTO client (
         seller_id,
         name,
         legal_name,
         address,
         city,
         state,
         pincode,
         gstin,
         pan,
         phone,
         email
       ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        legal_name || null,
        address || null,
        city || null,
        state || null,
        pincode || null,
        gstin || null,
        pan || null,
        phone || null,
        email || null
      ]
    );

    res.status(201).json({
      message: 'Client created successfully',
      client_id: result.insertId
    });
  } catch (err) { next(err); }
});

// PUT /api/client/:id
router.put('/:id', requireFields(['name']), async (req, res, next) => {
  try {
    const {
      name, legal_name, address,
      city, state, pincode,
      gstin, pan, phone, email
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const [result] = await db.query(
      `UPDATE client SET
         name       = ?,
         legal_name = ?,
         address    = ?,
         city       = ?,
         state      = ?,
         pincode    = ?,
         gstin      = ?,
         pan        = ?,
         phone      = ?,
         email      = ?
       WHERE client_id = ? AND is_active = 1`,
      [
        name, legal_name || null, address || null,
        city || null, state || null, pincode || null,
        gstin || null, pan || null,
        phone || null, email || null,
        req.params.id
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    res.json({ message: 'Client updated successfully' });
  } catch (err) { next(err); }
});

// DELETE /api/client/:id  (soft delete)
router.delete('/:id', async (req, res, next) => {
  try {
    const [result] = await db.query(
      `UPDATE client SET
         is_active  = 0,
         deleted_at = NOW()
       WHERE client_id = ? AND is_active = 1`,
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    res.json({ message: 'Client deleted successfully' });
  } catch (err) { next(err); }
});

module.exports = router;