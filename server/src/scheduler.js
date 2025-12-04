const cron = require('node-cron');
const Shop = require('./models/Shop');
const { syncShopResources, normalizeShopDomain, verifyShopCredentials } = require('./services/shopifyService');

const markShopError = async (shop, err) => {
  shop.status = 'paused';
  const meta = shop.metadata instanceof Map ? shop.metadata : new Map();
  meta.set('lastError', err.message);
  meta.set('lastErrorStatus', String(err.status || ''));
  meta.set('lastErrorAt', new Date().toISOString());
  shop.metadata = meta;
  await shop.save();
  console.error(`Paused shop ${shop.shopDomain} due to repeated sync errors`);
};

const startScheduler = () => {
  const cronExpr = process.env.SYNC_CRON || '*/30 * * * *'; // every 30 minutes
  const enabled = process.env.ENABLE_SYNC_CRON !== 'false';

  if (!enabled) {
    console.log('Sync scheduler disabled (ENABLE_SYNC_CRON=false)');
    return;
  }

  console.log(`Starting sync scheduler with cron "${cronExpr}"`);
  cron.schedule(cronExpr, async () => {
    const shops = await Shop.find({ status: 'active' });
    console.log(`Cron sync triggered for ${shops.length} shops`);

    for (const shop of shops) {
      try {
        const normalizedDomain = normalizeShopDomain(shop.shopDomain);
        if (!normalizedDomain) {
          throw new Error('Invalid shop domain. Provide the Admin hostname like "your-store.myshopify.com".');
        }
        if (normalizedDomain !== shop.shopDomain) {
          shop.shopDomain = normalizedDomain;
          await shop.save();
        }

        // Fail fast on bad tokens/domains so we can pause noisy shops.
        await verifyShopCredentials(shop);

        const summary = await syncShopResources(shop);
        shop.lastSyncedAt = new Date();
        await shop.save();
        console.log(`Synced shop ${shop.shopDomain}`, summary);
      } catch (err) {
        console.error(`Cron sync failed for ${shop.shopDomain}`, err.message);
        if (
          err.status === 404 ||
          err.status === 401 ||
          err.status === 403 ||
          /Invalid shop domain/i.test(err.message)
        ) {
          await markShopError(shop, err);
        }
      }
    }
  });
};

module.exports = startScheduler;
