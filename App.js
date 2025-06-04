const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const app = express();

// Middleware
app.use(express.json());
app.use(cors());


// MongoDB Connection
mongoose
  .connect("mongodb://localhost:27017/isp_billing",)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('Error connecting to MongoDB:', err));

    
    
       
const authenticate = (req, res, next) => {
      const token = req.headers.authorization?.split(' ')[1];
  
      if (!token) return res.status(401).json({ message: 'Access denied. No token provided' });
  
      try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          req.user = decoded;
          next();
      } catch (err) {
          res.status(401).json({ message: 'Invalid token' });
      }
  };
  
  module.exports = authenticate;
// Routes
const customerRoutes = require('./routes/Customer');
const planRoutes = require('./routes/plans');
const invoiceRoutes = require('./routes/invoices');
const usageLogsRoutes = require('./routes/usageLogs');
const adminAuthRoutes = require('./routes/adminAuth');
const statsRoutes = require('./routes/Stats');
const payProcessRoutes = require('./routes/PayProcess');
const mikrotikUserRoutes = require('./routes/mikrotikUser');
const routerConnectRoutes = require('./routes/mikrotikclient');

app.use('/api/customers', customerRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/Invoices', invoiceRoutes);
app.use('/api/usageLogs', usageLogsRoutes);
app.use('/api/auth', adminAuthRoutes);
app.use('/api', statsRoutes);
app.use('/api/payProcess', payProcessRoutes);
app.use('/api/mikrotik/users', mikrotikUserRoutes);
app.use('/api', routerConnectRoutes);


// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
