const express = require('express');
const mongoose = require('mongoose');
const Shop = require('../models/Shop');
const { syncShopResources, normalizeShopDomain, verifyShopCredentials } = require('../services/shopifyService');

const looksLikeUrl = (value) => {
  try {
    new URL(value);
    return true;
  } catch (err) {
    return /\:\/\//.test(String(value || ''));
  }
};

const validateAccessToken = (token) => {
  const trimmed = String(token || '').trim();
  if (!trimmed) return 'Admin API access token is required.';
  if (looksLikeUrl(trimmed)) return 'Access token looks like a URL. Paste the Admin API access token from Shopify.';
  if (trimmed.length < 20) return 'Access token looks too short. Paste the full Admin API access token.';
  return null;
};

const router = express.Router();

router.get('/', async (req, res) => {
  const filter = req.userEmail ? { ownerEmail: req.userEmail } : {};
  const shops = await Shop.find(filter).sort({ createdAt: -1 });
  res.json(shops);
});

router.post('/register', async (req, res) => {
  const { shopDomain, accessToken, name, apiVersion, scopes } = req.body;
  if (!shopDomain || !accessToken) {
    return res.status(400).json({ message: 'shopDomain and accessToken are required' });
  }

  const tokenError = validateAccessToken(accessToken);
  if (tokenError) {
    return res.status(400).json({ message: tokenError });
  }

  const normalizedDomain = normalizeShopDomain(shopDomain);
  if (!normalizedDomain) {
    return res
      .status(400)
      .json({ message: 'Invalid shopDomain. Use the Admin hostname, e.g. "your-store.myshopify.com".' });
  }

  const rawLower = String(shopDomain).trim().toLowerCase();
  const apiVersionToUse = apiVersion || process.env.SHOPIFY_API_VERSION;

  let domainAliases = [normalizedDomain, rawLower];
  if (normalizedDomain.endsWith('.myshopify.com')) {
    domainAliases.push(normalizedDomain.replace('.myshopify.com', ''));
  }

  let canonicalDomain = normalizedDomain;
  try {
    const verification = await verifyShopCredentials({
      shopDomain: normalizedDomain,
      accessToken,
      apiVersion: apiVersionToUse,
    });
    canonicalDomain = verification.canonicalDomain || normalizedDomain;
  } catch (err) {
    return res.status(err.status || 400).json({ message: err.message });
  }

  if (canonicalDomain && canonicalDomain !== normalizedDomain) {
    domainAliases = Array.from(
      new Set([
        ...domainAliases,
        canonicalDomain,
        canonicalDomain.endsWith('.myshopify.com') ? canonicalDomain.replace('.myshopify.com', '') : null,
      ].filter(Boolean))
    );
  }

  const shop = await Shop.findOneAndUpdate(
    { shopDomain: { $in: domainAliases } },
    {
      shopDomain: canonicalDomain,
      accessToken,
      name,
      ownerEmail: req.userEmail,
      apiVersion: apiVersionToUse,
      scopes,
      status: 'active',
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  res.json(shop);
});

router.post('/:id/sync', async (req, res) => {
  const { id } = req.params;
  const resources = req.body.resources || ['customers', 'orders', 'products'];

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'Invalid shop id' });
  }

  const shop = await Shop.findById(id);
  if (!shop) {
    return res.status(404).json({ message: 'Shop not found' });
  }
  if (shop.ownerEmail && shop.ownerEmail !== req.userEmail) {
    return res.status(403).json({ message: 'Not allowed to sync this shop' });
  }

  const normalizedDomain = normalizeShopDomain(shop.shopDomain);
  if (!normalizedDomain) {
    return res.status(400).json({
      message: 'Invalid shop domain. Please provide the Admin hostname like "your-store.myshopify.com".',
    });
  }
  if (normalizedDomain !== shop.shopDomain) {
    shop.shopDomain = normalizedDomain;
    await shop.save();
  }

  const tokenError = validateAccessToken(shop.accessToken);
  if (tokenError) {
    return res.status(400).json({ message: tokenError });
  }

  try {
    const verification = await verifyShopCredentials(shop);
    if (verification.canonicalDomain && verification.canonicalDomain !== shop.shopDomain) {
      shop.shopDomain = verification.canonicalDomain;
      await shop.save();
    }
  } catch (err) {
    return res.status(err.status || 400).json({ message: err.message });
  }

  try {
    const summary = await syncShopResources(shop, resources);
    shop.lastSyncedAt = new Date();
    await shop.save();
    res.json({ shopId: shop.id, summary });
  } catch (err) {
    const status = err.status || err.response?.status;
    const payload = err.response?.data;
    console.error('sync error', err.message);
    res.status(status || 500).json({
      message: 'Sync failed',
      error: err.message,
      details: payload,
    });
  }
});

module.exports = router;
