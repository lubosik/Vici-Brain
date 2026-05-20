'use strict';
require('dotenv').config();
const express = require('express');
const router = express.Router();
const supabase = require('../db');

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  return res.status(401).json({ error: 'Unauthorised' });
}

async function getDashboardStats() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [todayOrders, monthOrders, allCustomers, lifecycle, lastCampaign, signals] = await Promise.all([
    supabase.from('brain_orders').select('total, created_at').gte('created_at', todayStart.toISOString()),
    supabase.from('brain_orders').select('total, items').gte('created_at', monthStart.toISOString()),
    supabase.from('brain_customers').select('id, lifecycle_stage', { count: 'exact' }),
    supabase.from('brain_customers').select('lifecycle_stage'),
    supabase.from('brain_email_campaigns').select('*').order('sent_at', { ascending: false }).limit(1).single(),
    supabase.from('brain_signals').select('priority').eq('status', 'pending')
  ]);

  const todayRev = (todayOrders.data || []).reduce((s, o) => s + parseFloat(o.total || 0), 0);
  const monthRev = (monthOrders.data || []).reduce((s, o) => s + parseFloat(o.total || 0), 0);

  // Count lifecycle stages
  const lc = {};
  for (const c of (lifecycle.data || [])) {
    lc[c.lifecycle_stage] = (lc[c.lifecycle_stage] || 0) + 1;
  }

  // Top product this month
  const productCounts = {};
  for (const o of (monthOrders.data || [])) {
    const items = Array.isArray(o.items) ? o.items : [];
    for (const i of items) {
      productCounts[i.name] = (productCounts[i.name] || 0) + (i.quantity || 1);
    }
  }
  const topProduct = Object.entries(productCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

  const pendingSignals = (signals.data || []);
  const highPriority = pendingSignals.filter(s => s.priority === 'high' || s.priority === 'urgent').length;

  return {
    today: {
      orders: todayOrders.data?.length || 0,
      revenue: todayRev.toFixed(2),
      new_customers: 0
    },
    this_month: {
      orders: monthOrders.data?.length || 0,
      revenue: monthRev.toFixed(2),
      top_product: topProduct
    },
    all_time: {
      total_customers: allCustomers.count || 0,
      total_orders: 0,
      total_revenue: 0
    },
    lifecycle: lc,
    last_campaign: lastCampaign.data || null,
    signals: { high: highPriority, total: pendingSignals.length }
  };
}

router.get('/dashboard/stats', requireAuth, async (req, res) => {
  try {
    res.json(await getDashboardStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/dashboard/feed', requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    // Pull from brain_orders ordered by actual WooCommerce order date — always accurate regardless of sync timing
    const { data: orders, error } = await supabase
      .from('brain_orders')
      .select('woo_order_id, customer_email, customer_phone, status, total, items, tracking_number, carrier, shipment_status, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;

    const feed = (orders || []).map(o => {
      const items = Array.isArray(o.items) ? o.items : [];
      const productList = items.map(i => i.name).filter(Boolean).join(', ') || 'Products';
      const shipped = o.tracking_number ? ` · Tracking: ${o.tracking_number}` : '';
      return {
        id: `order-${o.woo_order_id}`,
        event_type: `order.${o.status}`,
        source: 'woocommerce',
        customer_email: o.customer_email,
        created_at: o.created_at,
        payload: {
          order_id: o.woo_order_id,
          total: o.total,
          status: o.status,
          items: items.map(i => i.name),
          summary: `Order #${o.woo_order_id} — ${o.customer_email} — $${o.total} — ${productList}${shipped}`
        }
      };
    });
    res.json(feed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/dashboard/signals', requireAuth, async (req, res) => {
  try {
    let q = supabase.from('brain_signals').select('*').order('created_at', { ascending: false });
    if (req.query.status) q = q.eq('status', req.query.status);
    if (req.query.priority) q = q.eq('priority', req.query.priority);
    const { data, error } = await q.limit(100);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/customers', requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const from = (page - 1) * limit;
    let q = supabase.from('brain_customers')
      .select('*', { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(from, from + limit - 1);
    if (req.query.lifecycle) q = q.eq('lifecycle_stage', req.query.lifecycle);
    if (req.query.search) {
      q = q.or(`email.ilike.%${req.query.search}%,first_name.ilike.%${req.query.search}%,last_name.ilike.%${req.query.search}%`);
    }
    const { data, count, error } = await q;
    if (error) throw error;
    res.json({ customers: data, total: count, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/customers/:email', requireAuth, async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const [custRes, profileRes, ordersRes, signalsRes] = await Promise.all([
      supabase.from('brain_customers').select('*').eq('email', email).single(),
      supabase.from('brain_customer_profiles').select('*').eq('customer_email', email).single(),
      supabase.from('brain_orders').select('*').eq('customer_email', email).order('created_at', { ascending: false }).limit(10),
      supabase.from('brain_signals').select('*').eq('customer_email', email).eq('status', 'pending').limit(10)
    ]);
    res.json({
      customer: custRes.data,
      profile: profileRes.data,
      orders: ordersRes.data,
      signals: signalsRes.data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/orders', requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const from = (page - 1) * limit;
    let q = supabase.from('brain_orders')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);
    if (req.query.status && req.query.status !== 'all') q = q.eq('status', req.query.status);
    if (req.query.search) q = q.or(`woo_order_id.eq.${req.query.search},customer_email.ilike.%${req.query.search}%`);
    const { data, count, error } = await q;
    if (error) throw error;
    res.json({ orders: data, total: count, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/products/top', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('brain_products').select('*').order('total_sold', { ascending: false }).limit(20);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/campaigns', requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const { data, error } = await supabase.from('brain_email_campaigns').select('*').order('sent_at', { ascending: false }).limit(limit);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/signals/:id/action', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase.from('brain_signals').update({ status: 'actioned' }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/signals/:id/dismiss', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase.from('brain_signals').update({ status: 'dismissed' }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/customers/:email/analyse', requireAuth, async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const intelligence = require('../intelligence');
    const profile = await intelligence.analyseCustomer(email);
    res.json({ profile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual sync triggers
router.post('/sync/woocommerce', requireAuth, (req, res) => {
  res.json({ message: 'WooCommerce sync started' });
  require('../sync/woocommerce').syncRecentOrders().catch(e => console.error(e.message));
});

router.post('/sync/omnisend', requireAuth, (req, res) => {
  res.json({ message: 'Omnisend sync started' });
  require('../sync/omnisend').syncAll().catch(e => console.error(e.message));
});

router.post('/sync/shipstation', requireAuth, (req, res) => {
  res.json({ message: 'ShipStation sync started' });
  require('../sync/shipstation').syncShipments().catch(e => console.error(e.message));
});

module.exports = router;
module.exports.getDashboardStats = getDashboardStats;
