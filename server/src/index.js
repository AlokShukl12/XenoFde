require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');

const connectDB = require('./config/db');
const auth = require('./middleware/auth');
const shopRoutes = require('./routes/shops');
const insightRoutes = require('./routes/insights');
const webhookRoutes = require('./routes/webhooks');
const eventRoutes = require('./routes/events');
const startScheduler = require('./scheduler');

const app = express();

app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Webhooks are unauthenticated (Shopify posts).
app.use('/api/webhooks', webhookRoutes);

// Require email auth for all other API routes.
app.use('/api', auth);
app.use('/api/shops', shopRoutes);
app.use('/api/insights', insightRoutes);
app.use('/api/events', eventRoutes);

const PORT = process.env.PORT || 4000;

connectDB().then(() => {
  startScheduler();
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
});
