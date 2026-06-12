const router = require('express').Router();
router.get('/',(req,res)=>{
    res.json({
        message: 'Payment routes working'
    });
}); 
module.exports = router;