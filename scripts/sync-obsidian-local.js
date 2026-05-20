'use strict';
require('dotenv').config();

// Override to local vault path
process.env.OBSIDIAN_VAULT_PATH = './obsidian-vault';

const supabase = require('../db');
const obsidian = require('../obsidian');
const { getDashboardStats } = require('../routes/dashboard');

async function run() {
  console.log('Fetching data from Supabase...');

  const [custRes, ordersRes, productsRes, campaignsRes, signalsRes, profilesRes] = await Promise.all([
    supabase.from('brain_customers').select('*').order('updated_at', { ascending: false }).limit(500),
    supabase.from('brain_orders').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('brain_products').select('*').order('total_sold', { ascending: false }),
    supabase.from('brain_email_campaigns').select('*').order('sent_at', { ascending: false }).limit(50),
    supabase.from('brain_signals').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(100),
    supabase.from('brain_customer_profiles').select('*')
  ]);

  const customers = custRes.data || [];
  const orders = ordersRes.data || [];
  const products = productsRes.data || [];
  const campaigns = campaignsRes.data || [];
  const signals = signalsRes.data || [];
  const profiles = profilesRes.data || [];

  console.log(`Found: ${customers.length} customers, ${orders.length} orders, ${products.length} products, ${campaigns.length} campaigns, ${signals.length} signals`);

  // Build profile lookup
  const profileMap = {};
  for (const p of profiles) profileMap[p.customer_email] = p;

  // Build orders-by-customer lookup
  const ordersByCustomer = {};
  for (const o of orders) {
    if (!o.customer_email) continue;
    if (!ordersByCustomer[o.customer_email]) ordersByCustomer[o.customer_email] = [];
    ordersByCustomer[o.customer_email].push(o);
  }

  // Write customer notes
  console.log('Writing customer notes...');
  let done = 0;
  for (const c of customers) {
    const profile = profileMap[c.email] || {};
    const custOrders = ordersByCustomer[c.email] || [];
    await obsidian.writeCustomerNote(c, profile, custOrders).catch(e => console.error(`Customer ${c.email}:`, e.message));
    done++;
    if (done % 50 === 0) console.log(`  ${done}/${customers.length} customers...`);
  }
  console.log(`  ${customers.length} customer notes written`);

  // Write order notes
  console.log('Writing order notes...');
  done = 0;
  for (const o of orders) {
    await obsidian.writeOrderNote(o).catch(e => console.error(`Order ${o.woo_order_id}:`, e.message));
    done++;
    if (done % 100 === 0) console.log(`  ${done}/${orders.length} orders...`);
  }
  console.log(`  ${orders.length} order notes written`);

  // Write product notes
  console.log('Writing product notes...');
  for (const p of products) {
    await obsidian.writeProductNote(p).catch(e => console.error(`Product ${p.name}:`, e.message));
  }
  console.log(`  ${products.length} product notes written`);

  // Write campaign notes
  console.log('Writing campaign notes...');
  for (const c of campaigns) {
    await obsidian.writeCampaignNote(c).catch(e => console.error(`Campaign ${c.name}:`, e.message));
  }
  console.log(`  ${campaigns.length} campaign notes written`);

  // Write signal notes
  console.log('Writing signal notes...');
  for (const s of signals) {
    await obsidian.writeIntelligenceSignal(s).catch(e => console.error(`Signal:`, e.message));
  }
  console.log(`  ${signals.length} signal notes written`);

  // Write stats and regenerate indexes
  console.log('Updating stats + indexes...');
  try {
    const stats = await getDashboardStats();
    await obsidian.writeStatsNote(stats);
    await obsidian.updateIndexes();
    console.log('Stats and indexes updated');

    // Print summary
    const lc = stats.lifecycle || {};
    console.log('\n=== VICI BRAIN SNAPSHOT ===');
    console.log(`Total customers:  ${stats.all_time?.total_customers || customers.length}`);
    console.log(`New:              ${lc.new || 0}`);
    console.log(`Active:           ${lc.active || 0}`);
    console.log(`Loyal:            ${lc.loyal || 0}`);
    console.log(`Champion:         ${lc.champion || 0}`);
    console.log(`At risk:          ${lc.at_risk || 0}`);
    console.log(`Lapsed:           ${lc.lapsed || 0}`);
    console.log(`Today orders:     ${stats.today?.orders || 0}  ($${stats.today?.revenue || 0})`);
    console.log(`Month orders:     ${stats.this_month?.orders || 0}  ($${stats.this_month?.revenue || 0})`);
    console.log(`Pending signals:  ${stats.signals?.total || signals.length} (${stats.signals?.high || 0} high priority)`);
    if (stats.last_campaign) {
      console.log(`Last campaign:    ${stats.last_campaign.name} — ${stats.last_campaign.open_rate}% open`);
    }
    console.log('===========================\n');
  } catch (e) {
    console.error('Stats/index error:', e.message);
  }

  console.log('Obsidian sync complete. Reload vault in Obsidian to see changes.');
  process.exit(0);
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
