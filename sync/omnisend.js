'use strict';
require('dotenv').config();
const supabase = require('../db');

const BASE_URL = 'https://api.omnisend.com/v5';

async function omnisendFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'X-API-KEY': process.env.OMNISEND_API_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) throw new Error(`Omnisend ${res.status} ${path}: ${await res.text()}`);
  return res.json();
}

async function fetchCampaigns() {
  try {
    const data = await omnisendFetch('/campaigns?limit=50&status=sent');
    const campaigns = data.campaigns || [];
    for (const c of campaigns) {
      const openRate = c.statistics?.recipients > 0
        ? (c.statistics.opens / c.statistics.recipients * 100).toFixed(2)
        : 0;
      const clickRate = c.statistics?.recipients > 0
        ? (c.statistics.clicks / c.statistics.recipients * 100).toFixed(2)
        : 0;
      await supabase.from('brain_email_campaigns').upsert({
        omnisend_campaign_id: c.campaignID,
        name: c.name,
        subject: c.content?.subject || '',
        status: c.status,
        sent_at: c.statistics?.sentAt || null,
        recipients: c.statistics?.recipients || 0,
        opens: c.statistics?.opens || 0,
        clicks: c.statistics?.clicks || 0,
        unsubscribes: c.statistics?.unsubscribes || 0,
        revenue: c.statistics?.salesSum || 0,
        open_rate: parseFloat(openRate),
        click_rate: parseFloat(clickRate),
        fetched_at: new Date().toISOString()
      }, { onConflict: 'omnisend_campaign_id' });
    }
    console.log(`Omnisend: synced ${campaigns.length} campaigns`);

    // Write Obsidian notes
    const obsidian = require('../obsidian');
    for (const c of campaigns) {
      const { data: row } = await supabase.from('brain_email_campaigns').select('*').eq('omnisend_campaign_id', c.campaignID).single();
      if (row) {
        await obsidian.writeCampaignNote(row).catch(e => console.error('Obsidian campaign write error:', e.message));
      }
    }
  } catch (err) {
    console.error('Omnisend fetchCampaigns error:', err.message);
  }
}

async function fetchContacts(page = 1) {
  try {
    const data = await omnisendFetch(`/contacts?limit=250&page=${page}`);
    const contacts = data.contacts || [];
    for (const c of contacts) {
      if (!c.email) continue;
      await supabase.from('brain_customers').upsert({
        email: c.email,
        omnisend_contact_id: c.contactID,
        updated_at: new Date().toISOString()
      }, { onConflict: 'email' });
    }
    console.log(`Omnisend: synced ${contacts.length} contacts page ${page}`);
    return contacts.length;
  } catch (err) {
    console.error('Omnisend fetchContacts error:', err.message);
    return 0;
  }
}

async function getCampaignStats(campaignId) {
  return omnisendFetch(`/campaigns/${campaignId}`);
}

async function syncAll() {
  await fetchCampaigns();
  let page = 1;
  while (true) {
    const count = await fetchContacts(page);
    if (count < 250) break;
    page++;
  }
}

async function sendCustomEvent(email, eventName, properties) {
  try {
    await omnisendFetch('/events', {
      method: 'POST',
      body: JSON.stringify({
        eventName,
        origin: 'api',
        contact: { email },
        properties
      })
    });
  } catch (err) {
    console.error('Omnisend sendCustomEvent error:', err.message);
  }
}

module.exports = { fetchCampaigns, fetchContacts, getCampaignStats, syncAll, sendCustomEvent };
