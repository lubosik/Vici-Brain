'use strict';
require('dotenv').config();
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const woocommerce = require('../sync/woocommerce');
const shipstation = require('../sync/shipstation');

// WooCommerce HMAC-SHA256 signature check
function verifyWooSignature(req) {
  if (!process.env.WOOCOMMERCE_WEBHOOK_SECRET) return true;
  const sig = req.headers['x-wc-webhook-signature'];
  if (!sig) return false;
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
  const expected = crypto
    .createHmac('sha256', process.env.WOOCOMMERCE_WEBHOOK_SECRET)
    .update(body)
    .digest('base64');
  return sig === expected;
}

function parseBody(raw) {
  if (Buffer.isBuffer(raw)) return JSON.parse(raw.toString());
  if (typeof raw === 'string') return JSON.parse(raw);
  return raw;
}

// ── ORDERS ─────────────────────────────────────────
// Topics: order.created, order.updated  → same URL
router.post('/woocommerce/order', (req, res) => {
  res.sendStatus(200);
  if (!verifyWooSignature(req)) { console.warn('WooCommerce order webhook: bad signature'); return; }
  const topic = req.headers['x-wc-webhook-topic'] || '';
  if (topic === 'order.deleted' || topic === 'order.restored') {
    woocommerce.processWebhookOrderDeleted(req.body).catch(e => console.error('Order delete webhook error:', e.message));
  } else {
    woocommerce.processWebhookOrder(req.body).catch(e => console.error('Order webhook error:', e.message));
  }
});

// Topic: order.deleted  (separate URL for clarity, both work)
router.post('/woocommerce/order/deleted', (req, res) => {
  res.sendStatus(200);
  woocommerce.processWebhookOrderDeleted(req.body).catch(e => console.error('Order deleted webhook error:', e.message));
});

// ── CUSTOMERS ───────────────────────────────────────
// Topics: customer.created, customer.updated  → same URL
router.post('/woocommerce/customer', (req, res) => {
  res.sendStatus(200);
  if (!verifyWooSignature(req)) { console.warn('WooCommerce customer webhook: bad signature'); return; }
  const topic = req.headers['x-wc-webhook-topic'] || '';
  // Skip deleted customers — just leave them in DB
  if (topic === 'customer.deleted') { console.log('Customer deleted event received — no action'); return; }
  woocommerce.processWebhookCustomer(req.body).catch(e => console.error('Customer webhook error:', e.message));
});

// ── PRODUCTS ────────────────────────────────────────
// Topics: product.created, product.updated  → same URL
router.post('/woocommerce/product', (req, res) => {
  res.sendStatus(200);
  if (!verifyWooSignature(req)) { console.warn('WooCommerce product webhook: bad signature'); return; }
  const topic = req.headers['x-wc-webhook-topic'] || 'product.updated';
  // Skip deleted/trashed products
  if (topic === 'product.deleted') { console.log('Product deleted event received — no action'); return; }
  woocommerce.processWebhookProduct(req.body, topic).catch(e => console.error('Product webhook error:', e.message));
});

// ── SHIPSTATION ─────────────────────────────────────
router.post('/shipstation', (req, res) => {
  res.sendStatus(200);
  const body = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;
  shipstation.processShipmentWebhook(body).catch(e => console.error('ShipStation webhook error:', e.message));
});

module.exports = router;
