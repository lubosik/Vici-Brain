'use strict';
require('dotenv').config();
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const woocommerce = require('../sync/woocommerce');
const shipstation = require('../sync/shipstation');

router.post('/woocommerce/order', (req, res) => {
  res.sendStatus(200);
  // Verify signature if secret configured
  if (process.env.WOOCOMMERCE_WEBHOOK_SECRET) {
    const sig = req.headers['x-wc-webhook-signature'];
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    const expected = crypto
      .createHmac('sha256', process.env.WOOCOMMERCE_WEBHOOK_SECRET)
      .update(body)
      .digest('base64');
    if (sig !== expected) {
      console.warn('WooCommerce webhook signature mismatch');
      return;
    }
  }
  woocommerce.processWebhookOrder(req.body).catch(e => console.error('WooCommerce webhook error:', e.message));
});

router.post('/shipstation', (req, res) => {
  res.sendStatus(200);
  const body = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;
  shipstation.processShipmentWebhook(body).catch(e => console.error('ShipStation webhook error:', e.message));
});

module.exports = router;
