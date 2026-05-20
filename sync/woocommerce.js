'use strict';
require('dotenv').config();
const supabase = require('../db');

const BASE_URL = `${process.env.WOOCOMMERCE_URL}/wp-json/wc/v3`;

function getAuthHeader() {
  const encoded = Buffer.from(`${process.env.WOOCOMMERCE_CONSUMER_KEY}:${process.env.WOOCOMMERCE_CONSUMER_SECRET}`).toString('base64');
  return { 'Authorization': `Basic ${encoded}` };
}

async function wooFetch(path) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: getAuthHeader() });
  if (!res.ok) throw new Error(`WooCommerce ${res.status} ${path}: ${await res.text()}`);
  return res.json();
}

async function fetchRecentOrders(page = 1) {
  return wooFetch(`/orders?per_page=100&page=${page}&orderby=date&order=desc`);
}

async function fetchCustomers(page = 1) {
  return wooFetch(`/customers?per_page=100&page=${page}`);
}

async function fetchProducts() {
  return wooFetch('/products?per_page=100&status=publish');
}

async function processOrder(wooOrder) {
  try {
    const email = wooOrder.billing?.email;
    const phone = wooOrder.billing?.phone;
    const firstName = wooOrder.billing?.first_name || '';
    const lastName = wooOrder.billing?.last_name || '';

    // Upsert customer
    if (email) {
      await supabase.from('brain_customers').upsert({
        email,
        phone: phone || null,
        first_name: firstName,
        last_name: lastName,
        woo_customer_id: String(wooOrder.customer_id || ''),
        last_order_date: wooOrder.date_created || new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'email' });
    }

    // Get customer id
    let customerId = null;
    if (email) {
      const { data: cust } = await supabase.from('brain_customers').select('id').eq('email', email).single();
      customerId = cust?.id;
    }

    // Map items
    const items = (wooOrder.line_items || []).map(li => ({
      name: li.name,
      quantity: li.quantity,
      price: li.price,
      product_id: li.product_id
    }));

    // Upsert order
    await supabase.from('brain_orders').upsert({
      woo_order_id: String(wooOrder.id),
      customer_email: email,
      customer_phone: phone || null,
      brain_customer_id: customerId,
      status: wooOrder.status,
      total: parseFloat(wooOrder.total || 0),
      subtotal: parseFloat(wooOrder.subtotal || 0),
      shipping_total: parseFloat(wooOrder.shipping_total || 0),
      currency: wooOrder.currency || 'USD',
      items,
      billing_address: wooOrder.billing || null,
      shipping_address: wooOrder.shipping || null,
      payment_method: wooOrder.payment_method || null,
      created_at: wooOrder.date_created || new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'woo_order_id' });

    // Update product sold counts
    for (const li of (wooOrder.line_items || [])) {
      if (!li.product_id) continue;
      await supabase.from('brain_products').upsert({
        woo_product_id: String(li.product_id),
        name: li.name,
        updated_at: new Date().toISOString()
      }, { onConflict: 'woo_product_id' });

      const { data: prod } = await supabase.from('brain_products').select('total_sold, revenue').eq('woo_product_id', String(li.product_id)).single();
      if (prod) {
        await supabase.from('brain_products').update({
          total_sold: (prod.total_sold || 0) + (li.quantity || 1),
          revenue: (parseFloat(prod.revenue || 0) + parseFloat(li.total || 0)),
          updated_at: new Date().toISOString()
        }).eq('woo_product_id', String(li.product_id));
      }
    }

    // Recalculate customer stats
    if (email) {
      const { data: allOrders } = await supabase.from('brain_orders').select('total').eq('customer_email', email);
      if (allOrders) {
        const totalOrders = allOrders.length;
        const totalSpent = allOrders.reduce((s, o) => s + parseFloat(o.total || 0), 0);
        const avgOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0;
        await supabase.from('brain_customers').update({
          total_orders: totalOrders,
          total_spent: totalSpent.toFixed(2),
          avg_order_value: avgOrderValue.toFixed(2),
          updated_at: new Date().toISOString()
        }).eq('email', email);
      }
    }

    // Log event
    await supabase.from('brain_events').insert({
      event_type: 'order.created',
      source: 'woocommerce',
      customer_email: email,
      payload: { order_id: wooOrder.id, total: wooOrder.total, status: wooOrder.status, items: items.map(i => i.name) }
    });

    // Write Obsidian note
    const { data: orderRow } = await supabase.from('brain_orders').select('*').eq('woo_order_id', String(wooOrder.id)).single();
    if (orderRow) {
      const obsidian = require('../obsidian');
      await obsidian.writeOrderNote(orderRow).catch(e => console.error('Obsidian order write failed:', e.message));
    }

    // Trigger AI analysis for customers with 3+ orders
    if (email) {
      const { data: cust } = await supabase.from('brain_customers').select('total_orders').eq('email', email).single();
      if ((cust?.total_orders || 0) >= 3) {
        const intelligence = require('../intelligence');
        intelligence.analyseCustomer(email).catch(e => console.error('AI analysis failed:', e.message));
      }
    }
  } catch (err) {
    console.error('processOrder error:', err.message);
  }
}

async function processWebhookOrder(payload) {
  try {
    const body = Buffer.isBuffer(payload)
      ? JSON.parse(payload.toString())
      : (typeof payload === 'string' ? JSON.parse(payload) : payload);
    await processOrder(body);
  } catch (err) {
    console.error('processWebhookOrder error:', err.message);
  }
}

async function syncRecentOrders() {
  console.log('WooCommerce: syncing recent orders...');
  for (let page = 1; page <= 3; page++) {
    try {
      const orders = await fetchRecentOrders(page);
      if (!orders.length) break;
      for (const order of orders) await processOrder(order);
      console.log(`WooCommerce: page ${page}, ${orders.length} orders processed`);
      if (orders.length < 100) break;
    } catch (err) {
      console.error(`WooCommerce sync page ${page} error:`, err.message);
      break;
    }
  }
}

async function syncHistorical() {
  console.log('Historical sync: starting order sync from 2025-01-01...');
  let page = 1;
  let totalProcessed = 0;
  while (true) {
    try {
      const orders = await wooFetch(`/orders?per_page=100&page=${page}&after=2025-01-01T00:00:00&orderby=date&order=asc`);
      if (!orders.length) break;
      for (const order of orders) await processOrder(order);
      totalProcessed += orders.length;
      console.log(`Historical sync: page ${page}, ${totalProcessed} orders processed`);
      if (orders.length < 100) break;
      page++;
    } catch (err) {
      console.error(`Historical order sync page ${page} error:`, err.message);
      break;
    }
  }
  console.log(`Historical sync: completed ${totalProcessed} orders total`);

  // Historical customer sync
  console.log('Historical sync: starting customer sync...');
  let custPage = 1;
  let custTotal = 0;
  while (true) {
    try {
      const customers = await wooFetch(`/customers?per_page=100&page=${custPage}`);
      if (!customers.length) break;
      for (const c of customers) {
        await supabase.from('brain_customers').upsert({
          email: c.email,
          phone: c.billing?.phone || null,
          first_name: c.first_name || '',
          last_name: c.last_name || '',
          woo_customer_id: String(c.id),
          updated_at: new Date().toISOString()
        }, { onConflict: 'email' });
      }
      custTotal += customers.length;
      console.log(`Historical customer sync: page ${custPage}, ${custTotal} customers processed`);
      if (customers.length < 100) break;
      custPage++;
    } catch (err) {
      console.error(`Historical customer sync page ${custPage} error:`, err.message);
      break;
    }
  }
  console.log(`Historical customer sync: completed ${custTotal} customers total`);
}

module.exports = {
  fetchRecentOrders,
  fetchCustomers,
  fetchProducts,
  processOrder,
  processWebhookOrder,
  syncRecentOrders,
  syncHistorical
};
