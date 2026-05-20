'use strict';
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');

const VAULT = process.env.OBSIDIAN_VAULT_PATH || './obsidian-vault';
const BASE = path.join(VAULT, 'Vici Brain');

function sanitize(str) {
  return String(str || 'unknown').replace(/[\/\\:*?"<>|]/g, '-').trim();
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeCustomerNote(customer, profile = {}, orders = []) {
  await ensureDir(path.join(BASE, 'Customers'));
  const fileName = sanitize(customer.email) + '.md';
  const filePath = path.join(BASE, 'Customers', fileName);
  const affinities = (profile.product_affinities || []).join(', ');
  const restockSignals = (profile.restock_signals || []).map(s => `- ${s}`).join('\n') || '- None';
  const campaignSuggestions = (profile.campaign_suggestions || []).map(s => `- ${s}`).join('\n') || '- None';
  const orderTimeline = orders.map(o => `- [[Orders/${sanitize(o.woo_order_id)}|#${o.woo_order_id}]] — $${o.total} — ${o.status}`).join('\n') || '- No orders';
  const productsBought = orders.flatMap(o => {
    const items = Array.isArray(o.items) ? o.items : [];
    return items.map(i => `- ${i.name || 'Product'} (qty: ${i.quantity || 1})`);
  }).join('\n') || '- None';

  const content = `---
tags: [customer, ${sanitize(customer.lifecycle_stage || 'new')}, ${affinities}]
email: ${customer.email || ''}
phone: ${customer.phone || ''}
total_orders: ${customer.total_orders || 0}
total_spent: $${customer.total_spent || 0}
ltv_tier: ${profile.lifetime_value_tier || 'standard'}
churn_risk: ${profile.churn_risk || 'low'}
last_order: ${customer.last_order_date || ''}
last_updated: ${new Date().toISOString()}
---

# ${customer.first_name || ''} ${customer.last_name || ''}
**Email:** ${customer.email || ''}
**Phone:** ${customer.phone || ''}
**Lifecycle:** ${customer.lifecycle_stage || 'new'}
**LTV Tier:** ${profile.lifetime_value_tier || 'standard'}

## AI Summary
${profile.ai_summary || '_No analysis yet._'}

## Purchase History
- Total Orders: ${customer.total_orders || 0}
- Total Spent: $${customer.total_spent || 0}
- Average Order: $${customer.avg_order_value || 0}
- First Order: ${customer.first_order_date || '—'}
- Last Order: ${customer.last_order_date || '—'}

## Products Ordered
${productsBought}

## Restock Signals
${restockSignals}

## Recommended Campaigns
${campaignSuggestions}

## Order Timeline
${orderTimeline}
`;
  await fs.writeFile(filePath, content, 'utf8');
}

async function writeOrderNote(order) {
  await ensureDir(path.join(BASE, 'Orders'));
  const fileName = sanitize(order.woo_order_id) + '.md';
  const filePath = path.join(BASE, 'Orders', fileName);
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsList = items.map(i => `- ${i.quantity || 1}x ${i.name || 'Item'} — $${i.price || 0} each`).join('\n') || '- No items';
  const addr = order.shipping_address || {};
  const addrStr = [addr.first_name, addr.last_name, addr.address_1, addr.city, addr.state, addr.postcode, addr.country].filter(Boolean).join(', ');

  const content = `---
tags: [order, ${sanitize(order.status || 'unknown')}]
order_id: ${order.woo_order_id}
customer: "[[Customers/${sanitize(order.customer_email)}|${order.customer_email || ''}]]"
total: $${order.total || 0}
status: ${order.status || ''}
date: ${order.created_at || ''}
tracking: ${order.tracking_number || ''}
carrier: ${order.carrier || ''}
---

# Order #${order.woo_order_id}
**Customer:** [[Customers/${sanitize(order.customer_email)}|${order.customer_email || ''}]]
**Date:** ${order.created_at || ''}
**Status:** ${order.status || ''}
**Total:** $${order.total || 0}

## Items
${itemsList}

## Shipping
- Carrier: ${order.carrier || '—'}
- Tracking: ${order.tracking_number || '—'}
- Status: ${order.shipment_status || '—'}
- Delivered: ${order.delivered_at || '—'}

## Shipping Address
${addrStr || '—'}
`;
  await fs.writeFile(filePath, content, 'utf8');
}

async function writeCampaignNote(campaign) {
  await ensureDir(path.join(BASE, 'Campaigns'));
  const fileName = sanitize(campaign.name || campaign.omnisend_campaign_id) + '.md';
  const filePath = path.join(BASE, 'Campaigns', fileName);
  const content = `---
tags: [campaign, email]
campaign_id: ${campaign.omnisend_campaign_id || ''}
sent: ${campaign.sent_at || ''}
status: ${campaign.status || ''}
open_rate: ${campaign.open_rate || 0}%
click_rate: ${campaign.click_rate || 0}%
revenue: $${campaign.revenue || 0}
---

# ${campaign.name || 'Campaign'}
**Subject:** ${campaign.subject || ''}
**Sent:** ${campaign.sent_at || ''}
**Recipients:** ${campaign.recipients || 0}

## Performance
| Metric | Value |
|--------|-------|
| Opens | ${campaign.opens || 0} (${campaign.open_rate || 0}%) |
| Clicks | ${campaign.clicks || 0} (${campaign.click_rate || 0}%) |
| Unsubscribes | ${campaign.unsubscribes || 0} |
| Revenue | $${campaign.revenue || 0} |
`;
  await fs.writeFile(filePath, content, 'utf8');
}

async function writeProductNote(product) {
  await ensureDir(path.join(BASE, 'Products'));
  const fileName = sanitize(product.name || product.woo_product_id) + '.md';
  const filePath = path.join(BASE, 'Products', fileName);
  const content = `---
tags: [product]
sku: ${product.sku || ''}
price: $${product.price || 0}
stock: ${product.stock_quantity || 0}
stock_status: ${product.stock_status || ''}
total_sold: ${product.total_sold || 0}
---

# ${product.name || 'Product'}
**SKU:** ${product.sku || '—'}
**Price:** $${product.price || 0}
**Stock:** ${product.stock_quantity || 0} (${product.stock_status || '—'})
**Total Sold:** ${product.total_sold || 0} units
**Revenue:** $${product.revenue || 0}
`;
  await fs.writeFile(filePath, content, 'utf8');
}

async function writeIntelligenceSignal(signal) {
  await ensureDir(path.join(BASE, 'Intelligence'));
  const ts = Date.now();
  const fileName = sanitize(signal.signal_type || 'signal') + '-' + ts + '.md';
  const filePath = path.join(BASE, 'Intelligence', fileName);
  const content = `---
tags: [signal, ${sanitize(signal.signal_type || 'signal')}, ${sanitize(signal.priority || 'medium')}]
customer: "[[Customers/${sanitize(signal.customer_email)}]]"
priority: ${signal.priority || 'medium'}
status: ${signal.status || 'pending'}
date: ${signal.created_at || new Date().toISOString()}
---

# Signal: ${signal.signal_type || 'Intelligence Signal'}
**Customer:** [[Customers/${sanitize(signal.customer_email)}]]
**Priority:** ${signal.priority || 'medium'}
**Product:** ${signal.product_name || '—'}

## Suggested Action
${signal.suggested_action || '—'}

## Suggested Message
> ${signal.suggested_message || '—'}
`;
  await fs.writeFile(filePath, content, 'utf8');
}

async function writeStatsNote(stats = {}) {
  await ensureDir(BASE);
  const filePath = path.join(BASE, '_stats.md');
  const t = stats.today || {};
  const m = stats.this_month || {};
  const lc = stats.lifecycle || {};
  const signals = stats.signals || {};
  const content = `# Vici Peptides — Live Stats
*Updated: ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC*

## Today
- Orders: ${t.orders || 0}
- Revenue: $${t.revenue || 0}
- New customers: ${t.new_customers || 0}

## This Month
- Orders: ${m.orders || 0}
- Revenue: $${m.revenue || 0}
- Best seller: ${m.top_product || '—'}

## Email (last campaign)
- Campaign: ${(stats.last_campaign || {}).name || '—'}
- Open rate: ${(stats.last_campaign || {}).open_rate || 0}%
- Revenue: $${(stats.last_campaign || {}).revenue || 0}

## Customers
- Total: ${(stats.all_time || {}).total_customers || 0}
- Active: ${lc.active || 0}
- At risk: ${lc.at_risk || 0}
- Lapsed: ${lc.lapsed || 0}
- Champion: ${lc.champion || 0}

## Pending Signals
- High priority: ${signals.high || 0}
- Total: ${signals.total || 0}
`;
  await fs.writeFile(filePath, content, 'utf8');
}

async function updateIndexes() {
  const sections = ['Customers', 'Orders', 'Campaigns', 'Products', 'Intelligence'];
  for (const section of sections) {
    const dir = path.join(BASE, section);
    await ensureDir(dir);
    let files = [];
    try { files = await fs.readdir(dir); } catch {}
    const mdFiles = files.filter(f => f.endsWith('.md') && f !== '_Index.md');
    const links = mdFiles.map(f => {
      const name = f.replace('.md', '');
      return `- [[${section}/${name}|${name}]]`;
    }).join('\n') || '- None yet';

    let indexContent;
    if (section === 'Customers') {
      indexContent = `# Customers\n> Auto-generated. Do not edit.\n\n\`\`\`dataview\nTABLE total_spent AS "Spent", lifecycle_stage AS "Lifecycle", churn_risk AS "Churn Risk", last_order AS "Last Order"\nFROM "Vici Brain/Customers"\nWHERE file.name != "_Index"\nSORT total_spent DESC\n\`\`\`\n\n## All Customers\n${links}\n`;
    } else if (section === 'Orders') {
      indexContent = `# Orders\n> Auto-generated. Do not edit.\n\n\`\`\`dataview\nTABLE total AS "Total", status AS "Status", date AS "Date"\nFROM "Vici Brain/Orders"\nWHERE file.name != "_Index"\nSORT date DESC\nLIMIT 50\n\`\`\`\n\n## Recent Orders\n${links}\n`;
    } else if (section === 'Campaigns') {
      indexContent = `# Email Campaigns\n> Auto-generated. Do not edit.\n\n\`\`\`dataview\nTABLE open_rate AS "Open Rate", click_rate AS "Click Rate", revenue AS "Revenue", sent AS "Sent"\nFROM "Vici Brain/Campaigns"\nWHERE file.name != "_Index"\nSORT sent DESC\n\`\`\`\n\n## All Campaigns\n${links}\n`;
    } else if (section === 'Products') {
      indexContent = `# Products\n> Auto-generated. Do not edit.\n\n\`\`\`dataview\nTABLE price AS "Price", stock AS "Stock", total_sold AS "Units Sold", sku AS "SKU"\nFROM "Vici Brain/Products"\nWHERE file.name != "_Index"\nSORT total_sold DESC\n\`\`\`\n\n## All Products\n${links}\n`;
    } else {
      indexContent = `# Intelligence Signals\n> Auto-generated. Do not edit.\n\n\`\`\`dataview\nTABLE priority AS "Priority", status AS "Status", date AS "Date"\nFROM "Vici Brain/Intelligence"\nWHERE file.name != "_Index"\nSORT date DESC\nLIMIT 20\n\`\`\`\n\n## All Signals\n${links}\n`;
    }
    await fs.writeFile(path.join(dir, '_Index.md'), indexContent, 'utf8');
  }

  const mainIndex = path.join(BASE, '_Index.md');
  const mainContent = `---
cssclasses: [vici-brain-index]
---

# Vici Peptides Brain
> Auto-generated by the Vici Brain system. Do not edit manually.

## Live Stats
![[_stats]]

## Quick Links
- [[Customers/_Index|All Customers]]
- [[Orders/_Index|Recent Orders]]
- [[Campaigns/_Index|Email Campaigns]]
- [[Products/_Index|Products]]
- [[Intelligence/_Index|AI Signals]]

## About
This vault is the living knowledge base for Vici Peptides.
Every customer, order, campaign, and signal is auto-written here in real time.
Last updated: ${new Date().toISOString()}
`;
  await fs.writeFile(mainIndex, mainContent, 'utf8');
}

module.exports = {
  writeCustomerNote,
  writeOrderNote,
  writeCampaignNote,
  writeProductNote,
  writeIntelligenceSignal,
  writeStatsNote,
  updateIndexes
};
