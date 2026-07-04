//LOAD .env FIRST before anything else

require('dotenv').config();
require('./db');
// import paackages
const express = require('express');
const cors = require('cors');
const errorHandler = require('./src/middleware/errorHandler');
//Create Express application
const app = express();
//set up cors
// CORS = Cross Origin Resourxe Sharing
app.use(cors({
  origin: 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));
//Parse JSON request bodies
app.use(express.json());
// Register all routes files
app.use('/api/seller', require('./src/routes/seller.js'));
app.use('/api/tax', require('./src/routes/tax'));
app.use('/api/client', require('./src/routes/client'));
app.use('/api/product', require('./src/routes/product'));
app.use('/api/invoice', require('./src/routes/invoice'));
app.use('/api/payment', require('./src/routes/payment'));
app.use('/api/inventory', require('./src/routes/inventory'));
// Health check route
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Invoice API server is running',
    time: new Date().toISOString()
  });
});
//404 Handler 
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    message: `${req.method} ${req.url} does not exist`
  });
});
//Error Handler middleware
app.use(errorHandler);
//Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(' ');
  console.log('server is running');
  console.log('URL: http://localhost:' + PORT);
  console.log('Health: http://localhost:' + PORT + '/api/health');
  console.log(' ');
});