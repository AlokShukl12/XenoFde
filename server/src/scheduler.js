const cron = require('node-cron');
const Shop = require('./models/Shop');
const { syncShopResources } = require('./services/shopifyService');

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
        const summary = await syncShopResources(shop);
        shop.lastSyncedAt = new Date();
        await shop.save();
        console.log(`Synced shop ${shop.shopDomain}`, summary);
      } catch (err) {
        console.error(`Cron sync failed for ${shop.shopDomain}`, err.message);
      }
    }
  });
};

module.exports = startScheduler;
