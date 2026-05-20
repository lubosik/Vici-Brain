'use strict';
require('dotenv').config();
const supabase = require('../db');

const BASE_URL = 'https://rest.gohighlevel.com/v1';

function getHeaders() {
  return {
    'Authorization': `Bearer ${process.env.GHL_AGENCY_TOKEN}`,
    'Content-Type': 'application/json'
  };
}

async function syncContactsToGHL() {
  try {
    const { data: customers } = await supabase.from('brain_customers')
      .select('id, email, first_name, last_name, phone')
      .is('ghl_contact_id', null)
      .limit(50);

    for (const cust of (customers || [])) {
      try {
        // Search by email
        const searchRes = await fetch(
          `${BASE_URL}/contacts/search?email=${encodeURIComponent(cust.email)}&locationId=${process.env.GHL_LOCATION_ID}`,
          { headers: getHeaders() }
        );
        const searchData = await searchRes.json();
        const contacts = searchData.contacts || [];

        if (contacts.length > 0) {
          await supabase.from('brain_customers')
            .update({ ghl_contact_id: contacts[0].id, updated_at: new Date().toISOString() })
            .eq('id', cust.id);
        } else {
          // Create contact
          const createRes = await fetch(`${BASE_URL}/contacts`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({
              email: cust.email,
              firstName: cust.first_name,
              lastName: cust.last_name,
              phone: cust.phone,
              locationId: process.env.GHL_LOCATION_ID
            })
          });
          const created = await createRes.json();
          if (created.contact?.id) {
            await supabase.from('brain_customers')
              .update({ ghl_contact_id: created.contact.id, updated_at: new Date().toISOString() })
              .eq('id', cust.id);
          }
        }
      } catch (err) {
        console.error(`GHL sync error for ${cust.email}:`, err.message);
      }
    }
  } catch (err) {
    console.error('GHL syncContactsToGHL error:', err.message);
  }
}

async function updateGHLContactTags(email, tags) {
  try {
    const { data: cust } = await supabase.from('brain_customers').select('ghl_contact_id').eq('email', email).single();
    if (!cust?.ghl_contact_id) return;
    await fetch(`${BASE_URL}/contacts/${cust.ghl_contact_id}/tags`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ tags })
    });
  } catch (err) {
    console.error('GHL updateGHLContactTags error:', err.message);
  }
}

async function addGHLNote(email, note) {
  try {
    const { data: cust } = await supabase.from('brain_customers').select('ghl_contact_id').eq('email', email).single();
    if (!cust?.ghl_contact_id) return;
    await fetch(`${BASE_URL}/contacts/${cust.ghl_contact_id}/notes`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ body: note })
    });
  } catch (err) {
    console.error('GHL addGHLNote error:', err.message);
  }
}

module.exports = { syncContactsToGHL, updateGHLContactTags, addGHLNote };
