const express = require('express');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const prisma = require('../config/prisma');
const Shop = require('../models/Shop');

const router = express.Router();

const validateShop = (shopId) => mongoose.Types.ObjectId.isValid(shopId);

const parseDateRange = (startStr, endStr, defaultDays = 30) => {
  const end = endStr ? new Date(endStr) : new Date();
  const start = startStr ? new Date(startStr) : new Date(end.getTime() - defaultDays * 24 * 60 * 60 * 1000);
  return { start, end };
};

const computeTrend = async (shopObjectId) => {
  const now = new Date();
  const last7Start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const prev7Start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const prev7End = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const pipelineForRange = (start, end) => [
    { $match: { shop: shopObjectId, processedAt: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: null,
        revenue: { $sum: { $ifNull: ['$totalPrice', 0] } },
        orders: { $sum: 1 },
        avgOrderValue: { $avg: { $ifNull: ['$totalPrice', 0] } },
      },
    },
  ];

  const [current, previous] = await Promise.all([
    prisma.order.aggregateRaw({ pipeline: pipelineForRange(last7Start, now) }),
    prisma.order.aggregateRaw({ pipeline: pipelineForRange(prev7Start, prev7End) }),
  ]);

  const currentMetrics = current?.[0] || {};
  const previousMetrics = previous?.[0] || {};
  const delta = (curr, prev) => {
    if (!prev || prev === 0) return null;
    return Number((((curr || 0) - prev) / prev) * 100).toFixed(2);
  };

  return {
    revenue: {
      current: currentMetrics.revenue || 0,
      previous: previousMetrics.revenue || 0,
      deltaPct: delta(currentMetrics.revenue, previousMetrics.revenue),
    },
    orders: {
      current: currentMetrics.orders || 0,
      previous: previousMetrics.orders || 0,
      deltaPct: delta(currentMetrics.orders, previousMetrics.orders),
    },
    avgOrderValue: {
      current: currentMetrics.avgOrderValue || 0,
      previous: previousMetrics.avgOrderValue || 0,
      deltaPct: delta(currentMetrics.avgOrderValue, previousMetrics.avgOrderValue),
    },
  };
};

router.get('/:shopId/summary', async (req, res) => {
  const { shopId } = req.params;
  if (!validateShop(shopId)) {
    return res.status(400).json({ message: 'Invalid shop id' });
  }

  const shop = await Shop.findById(shopId);
  if (!shop) {
    return res.status(404).json({ message: 'Shop not found' });
  }
  if (shop.ownerEmail && shop.ownerEmail !== req.userEmail) {
    return res.status(403).json({ message: 'Not allowed to view insights for this shop' });
  }

  const shopObjectId = new ObjectId(shopId);

  const [customerCount, orderCount, productCount, eventCount, revenueAgg, recentOrders, trend] = await Promise.all([
    prisma.customer.count({ where: { shopId } }),
    prisma.order.count({ where: { shopId } }),
    prisma.product.count({ where: { shopId } }),
    prisma.event.count({ where: { shopId } }),
    prisma.order.aggregateRaw({
      pipeline: [
        { $match: { shop: shopObjectId } },
        { $group: { _id: null, revenue: { $sum: { $ifNull: ['$totalPrice', 0] } } } },
      ],
    }),
    prisma.order.findMany({
      where: { shopId },
      orderBy: { processedAt: 'desc' },
      take: 5,
    }),
    computeTrend(shopObjectId),
  ]);

  res.json({
    shopId,
    totals: {
      customers: customerCount,
      orders: orderCount,
      products: productCount,
      events: eventCount,
      revenue: revenueAgg?.[0]?.revenue || 0,
    },
    trend,
    recentOrders,
  });
});

router.get('/:shopId/orders-by-date', async (req, res) => {
  const { shopId } = req.params;
  if (!validateShop(shopId)) {
    return res.status(400).json({ message: 'Invalid shop id' });
  }
  const shop = await Shop.findById(shopId);
  if (!shop) {
    return res.status(404).json({ message: 'Shop not found' });
  }
  if (shop.ownerEmail && shop.ownerEmail !== req.userEmail) {
    return res.status(403).json({ message: 'Not allowed to view insights for this shop' });
  }
  const { start, end } = parseDateRange(req.query.start, req.query.end, 30);

  const rows = await prisma.order.aggregateRaw({
    pipeline: [
      { $match: { shop: new ObjectId(shopId), processedAt: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$processedAt' } },
          orders: { $sum: 1 },
          revenue: { $sum: { $ifNull: ['$totalPrice', 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ],
  });

  res.json(rows.map((row) => ({ date: row._id, orders: row.orders, revenue: row.revenue })));
});

router.get('/:shopId/top-customers', async (req, res) => {
  const { shopId } = req.params;
  if (!validateShop(shopId)) {
    return res.status(400).json({ message: 'Invalid shop id' });
  }
  const shop = await Shop.findById(shopId);
  if (!shop) {
    return res.status(404).json({ message: 'Shop not found' });
  }
  if (shop.ownerEmail && shop.ownerEmail !== req.userEmail) {
    return res.status(403).json({ message: 'Not allowed to view insights for this shop' });
  }
  const limit = Math.min(Number(req.query.limit) || 5, 20);

  const rows = await prisma.order.aggregateRaw({
    pipeline: [
      {
        $match: {
          shop: new ObjectId(shopId),
          totalPrice: { $gt: 0 },
          'customer.email': { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: '$customer.email',
          totalSpend: { $sum: { $ifNull: ['$totalPrice', 0] } },
          orders: { $sum: 1 },
          name: { $last: '$customer.firstName' },
        },
      },
      { $sort: { totalSpend: -1 } },
      { $limit: limit },
    ],
  });

  res.json(
    rows.map((row) => ({
      email: row._id,
      name: row.name,
      totalSpend: row.totalSpend,
      orders: row.orders,
    }))
  );
});

module.exports = router;
