const router = require('express').Router();
const db = require('../../db');

//POST/api/inventory/adjust
router.post('/adjust', async (req, res, next) => {
    try {
        const { product_id, quantity_change, movement_type } = req.body;
        if (!product_id || quantity_change === undefined || !movement_type) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        // 1.update the product stock
        await db.query(
            `UPDATE product
        SET current_stock = current_stock + ?
        WHERE product_id = ?`,
            [quantity_change, product_id]
        );
        // 2.Log the movment history
        await db.query(
            `INSERT INTO inventory_movement (
            product_id,
            quantity_change,
            movement_type
            
        ) VALUES (?, ?, ?)`,
            [product_id, quantity_change, movement_type]
        );
        res.json({ message: 'Stock adjusted successfully' });
    } catch (err) {
        next(err);
    }
});

module.exports = router;