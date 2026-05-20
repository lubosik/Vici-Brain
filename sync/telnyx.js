'use strict';
require('dotenv').config();
const supabase = require('../db');

async function fetchSMSConversations() {
  try {
    // Read from sms_contacts and sms_messages tables (populated by separate SMS inbox project)
    const { data: contacts, error } = await supabase.from('sms_contacts').select('id, phone, email').limit(100);
    if (error) {
      // Table may not exist in this Supabase project — silently skip
      return [];
    }
    const results = [];
    for (const contact of (contacts || [])) {
      const { data: messages } = await supabase.from('sms_messages')
        .select('body, direction, created_at')
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (!messages?.length) continue;

      // Match to brain_customers
      let customerEmail = contact.email || null;
      if (!customerEmail && contact.phone) {
        const { data: cust } = await supabase.from('brain_customers').select('email').eq('phone', contact.phone).single();
        customerEmail = cust?.email || null;
      }

      await supabase.from('brain_events').insert({
        event_type: 'sms.conversation',
        source: 'telnyx',
        customer_email: customerEmail,
        payload: {
          phone: contact.phone,
          message_count: messages.length,
          last_message: messages[0]?.body?.slice(0, 100)
        }
      });

      results.push({
        phone: contact.phone,
        email: customerEmail,
        messages,
        lastContact: messages[0]?.created_at
      });
    }
    return results;
  } catch (err) {
    console.error('Telnyx fetchSMSConversations error:', err.message);
    return [];
  }
}

module.exports = { fetchSMSConversations };
