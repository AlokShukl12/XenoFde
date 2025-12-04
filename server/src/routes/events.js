const express = require('express');
const mongoose = require('mongoose');
const Event = require('../models/Event');
const Shop = require('../models/Shop');

const router = express.Router();

router.get('/:shopId', async (req, res) => {
  const { shopId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  if (!mongoose.Types.ObjectId.isValid(shopId)) {
    return res.status(400).json({ message: 'Invalid shop id' });
  }

  const shop = await Shop.findById(shopId);
  if (!shop) {
    return res.status(404).json({ message: 'Shop not found' });
  }
  if (shop.ownerEmail && shop.ownerEmail !== req.userEmail) {
    return res.status(403).json({ message: 'Not allowed to access events for this shop' });
  }

  const events = await Event.find({ shop: shopId }).sort({ receivedAt: -1 }).limit(limit);
  res.json(events);
});

router.post('/:shopId', async (req, res) => {
  const { shopId } = req.params;
  const { topic, payload } = req.body;

  if (!mongoose.Types.ObjectId.isValid(shopId)) {
    return res.status(400).json({ message: 'Invalid shop id' });
  }

  const shop = await Shop.findById(shopId);
  if (!shop) {
    return res.status(404).json({ message: 'Shop not found' });
  }
  if (shop.ownerEmail && shop.ownerEmail !== req.userEmail) {
    return res.status(403).json({ message: 'Not allowed to push events for this shop' });
  }

  if (!topic) {
    return res.status(400).json({ message: 'topic is required' });
  }

  const event = await Event.create({ shop: shopId, topic: topic.toLowerCase(), payload, receivedAt: new Date() });
  res.status(201).json(event);
});

module.exports = router;
