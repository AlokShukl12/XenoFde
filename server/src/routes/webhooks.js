const express = require('express');
const Shop = require('../models/Shop');
const { handleWebhook } = require('../services/shopifyService');

const router = express.Router();

router.post('/shopify', async (req, res) => {
  const topic = req.headers['x-shopify-topic'];
  const shopDomain = req.headers['x-shopify-shop-domain'];

  if (!topic || !shopDomain) {
    return res.status(400).json({ message: 'Missing Shopify topic or shop domain headers' });
  }

  const shop = await Shop.findOne({ shopDomain: shopDomain.toLowerCase() });
  if (!shop) {
    return res.status(404).json({ message: 'Shop not registered', shopDomain });
  }

  try {
    const result = await handleWebhook(topic, req.body, shop);
    res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('webhook error', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
