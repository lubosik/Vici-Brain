'use strict';
require('dotenv').config();
const cron = require('node-cron');
const omnisend = require('../sync/omnisend');
const woocommerce = require('../sync/woocommerce');
const shipstation = require('../sync/shipstation');
const telnyx = require('../sync/telnyx');
const intelligence = require('../intelligence');
const obsidian = require('../obsidian');
const { getDashboardStats } = require('../routes/dashboard');

// Every 2 hours — Omnisend sync
cron.schedule('0 */2 * * *', async () => {
  try {
    await omnisend.syncAll();
    console.log('Omnisend sync complete');
  } catch (e) {
    console.error('Omnisend cron error:', e.message);
  }
});

// Every 4 hours — WooCommerce sync
cron.schedule('0 */4 * * *', async () => {
  try {
    await woocommerce.syncRecentOrders();
    console.log('WooCommerce sync complete');
  } catch (e) {
    console.error('WooCommerce cron error:', e.message);
  }
});

// Every 6 hours — ShipStation sync
cron.schedule('0 */6 * * *', async () => {
  try {
    await shipstation.syncShipments();
    console.log('ShipStation sync complete');
  } catch (e) {
    console.error('ShipStation cron error:', e.message);
  }
});

// Daily 7am UTC — batch AI analysis
cron.schedule('0 7 * * *', async () => {
  try {
    await intelligence.runBatchAnalysis();
    console.log('Batch analysis complete');
  } catch (e) {
    console.error('Batch analysis cron error:', e.message);
  }
});

// Daily 7:30am UTC — daily brief
cron.schedule('30 7 * * *', async () => {
  try {
    await intelligence.generateDailyBrief();
    console.log('Daily brief generated');
  } catch (e) {
    console.error('Daily brief cron error:', e.message);
  }
});

// Every hour — Obsidian vault refresh
cron.schedule('0 * * * *', async () => {
  try {
    await obsidian.updateIndexes();
    const stats = await getDashboardStats();
    await obsidian.writeStatsNote(stats);
    console.log('Obsidian vault refreshed');
  } catch (e) {
    console.error('Obsidian cron error:', e.message);
  }
});

// Every 15 minutes — Telnyx SMS sync
cron.schedule('*/15 * * * *', async () => {
  try {
    await telnyx.fetchSMSConversations();
  } catch (e) {
    console.error('Telnyx cron error:', e.message);
  }
});
