// This middleware catches any erroe thrown in any rout
//and returns a clean JSON respone instead of crashing server

const errorHandler = (err, req, res, next) => {
    console.error('Error', err.message);

    if (err.code === 'ER_N0_REFERENCED_ROW_2') {
        return res.status(409).json({
            error: 'Dublicate entry',
            message: 'A record with this value already exists'
        });
    }
    if (err.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(400).json({
            error: 'Invalid refrence',
            message: 'Refrenced data does not exist'
        });

    }
    res.status(err.status || 500).json({
        error: 'server.error',
        message: err.message || 'something went wrong'
    });
};

module.exports = errorHandler;