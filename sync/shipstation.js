'use strict';
require('dotenv').config();
const supabase = require('../db');

const BASE_URL = 'https://ssapi.shipstation.com';

function getAuthHeader() {
  const encoded = Buffer.from(`${process.env.SHIPSTATION_API_KEY}:${process.env.SHIPSTATION_API_SECRET}`).toString('base64');
  return { 'Authorization': `Basic ${encoded}` };
}

async function ssFetch(path) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: getAuthHeader() });
  if (!res.ok) throw new Error(`ShipStation ${res.status} ${path}: ${await res.text()}`);
  return res.json();
}

async function fetchRecentShipments() {
  return ssFetch('/shipments?pageSize=100&sortBy=ShipDate&sortDir=DESC');
}

async function getOrder(orderId) {
  return ssFetch(`/orders/${orderId}`);
}

async function processShipmentWebhook(payload) {
  try {
    const { resource_url } = payload;
    if (!resource_url) return;
    const res = await fetch(resource_url, { headers: getAuthHeader() });
    if (!res.ok) throw new Error(`ShipStation resource fetch failed: ${res.status}`);
    const data = await res.json();
    const shipments = data.shipments || [data];
    for (const shipment of shipments) {
      if (!shipment.orderNumber) continue;
      await supabase.from('brain_orders').update({
        tracking_number: shipment.trackingNumber || null,
        carrier: shipment.carrierCode || null,
        shipment_status: 'shipped',
        shipstation_order_id: String(shipment.orderId || ''),
        updated_at: new Date().toISOString()
      }).eq('woo_order_id', shipment.orderNumber);

      await supabase.from('brain_events').insert({
        event_type: 'order.shipped',
        source: 'shipstation',
        customer_email: null,
        payload: {
          order_number: shipment.orderNumber,
          tracking: shipment.trackingNumber,
          carrier: shipment.carrierCode
        }
      });
    }
  } catch (err) {
    console.error('ShipStation processShipmentWebhook error:', err.message);
  }
}

async function syncShipments() {
  try {
    const data = await fetchRecentShipments();
    const shipments = data.shipments || [];
    for (const s of shipments) {
      if (!s.orderNumber) continue;
      await supabase.from('brain_orders').update({
        tracking_number: s.trackingNumber || null,
        carrier: s.carrierCode || null,
        shipment_status: 'shipped',
        shipstation_order_id: String(s.orderId || ''),
        updated_at: new Date().toISOString()
      }).eq('woo_order_id', s.orderNumber);
    }
    console.log(`ShipStation: synced ${shipments.length} shipments`);
  } catch (err) {
    console.error('ShipStation syncShipments error:', err.message);
  }
}

async function registerWebhooks(targetUrl) {
  try {
    for (const event of ['ORDER_NOTIFY', 'SHIP_NOTIFY']) {
      const res = await fetch(`${BASE_URL}/webhooks/subscribe`, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_url: `${targetUrl}/webhooks/shipstation`, event })
      });
      console.log(`ShipStation webhook ${event}: ${res.status}`);
    }
  } catch (err) {
    console.error('ShipStation registerWebhooks error:', err.message);
  }
}

module.exports = { fetchRecentShipments, getOrder, processShipmentWebhook, syncShipments, registerWebhooks, getAuthHeader };
