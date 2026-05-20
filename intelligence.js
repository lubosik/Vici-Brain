'use strict';
require('dotenv').config();
const supabase = require('./db');
const obsidian = require('./obsidian');

const VICI_CONTEXT = `You are an AI analyst for Vici Peptides, a premium US research peptide store. Products include: BPC-157, TB-500, Semaglutide, Tirzepatide, CJC-1295, Ipamorelin, AOD-9604, GHK-Cu, PT-141, Melanotan II, Hexarelin, GHRP-6, Semax, Selank. Average order value: $80-150. Typical customer orders 3-6 times per year. Return research: customers who ordered 60+ days ago are at risk of churning.`;

async function callOpenRouter(systemPrompt, userPrompt) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://vici-brain.up.railway.app',
      'X-Title': 'Vici Brain Intelligence',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-haiku',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  let content = data.choices?.[0]?.message?.content || '';
  content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(content);
}

function calcLifecycle(customer) {
  const now = Date.now();
  const lastOrder = customer.last_order_date ? new Date(customer.last_order_date).getTime() : 0;
  const daysSince = (now - lastOrder) / (1000 * 60 * 60 * 24);
  const count = customer.total_orders || 0;
  const spent = parseFloat(customer.total_spent || 0);

  if (daysSince > 90) return 'lapsed';
  if (daysSince > 45) return 'at_risk';
  if (count >= 5 && spent > 400) return 'champion';
  if (count >= 5) return 'loyal';
  if (count >= 2) return 'active';
  return 'new';
}

async function analyseCustomer(email) {
  const [custRes, ordersRes, profileRes] = await Promise.all([
    supabase.from('brain_customers').select('*').eq('email', email).single(),
    supabase.from('brain_orders').select('*').eq('customer_email', email).order('created_at', { ascending: false }).limit(10),
    supabase.from('brain_customer_profiles').select('*').eq('customer_email', email).single()
  ]);

  const customer = custRes.data;
  if (!customer) throw new Error(`Customer not found: ${email}`);
  const orders = ordersRes.data || [];

  const orderSummary = orders.map(o => {
    const items = Array.isArray(o.items) ? o.items : [];
    return `Order #${o.woo_order_id} — $${o.total} — ${o.status} — ${o.created_at?.slice(0, 10)} — Items: ${items.map(i => i.name).join(', ')}`;
  }).join('\n');

  const userPrompt = `Customer: ${customer.first_name} ${customer.last_name} (${email})
Lifecycle: ${customer.lifecycle_stage} | Total Orders: ${customer.total_orders} | Total Spent: $${customer.total_spent}
Last Order: ${customer.last_order_date}

Orders:
${orderSummary || 'No orders yet'}

Respond with ONLY valid JSON (no markdown, no backticks):
{
  "product_affinities": ["product names this customer buys"],
  "purchase_patterns": "description of their buying pattern",
  "restock_signals": ["product they likely need to restock soon"],
  "churn_risk": "low|medium|high",
  "sentiment": "positive|neutral|negative",
  "lifetime_value_tier": "standard|silver|gold|vip",
  "recommended_products": ["product names to recommend next"],
  "campaign_suggestions": ["specific campaign ideas for this customer"],
  "ai_summary": "3-4 sentence plain English summary of this customer"
}`;

  let profile;
  try {
    profile = await callOpenRouter(VICI_CONTEXT + '\n\nAnalyse this customer and return JSON only.', userPrompt);
  } catch (err) {
    console.error(`OpenRouter analysis failed for ${email}:`, err.message);
    profile = {
      product_affinities: [],
      purchase_patterns: 'Insufficient data',
      restock_signals: [],
      churn_risk: 'low',
      sentiment: 'neutral',
      lifetime_value_tier: 'standard',
      recommended_products: [],
      campaign_suggestions: [],
      ai_summary: 'Analysis pending.'
    };
  }

  const lifecycle = calcLifecycle(customer);

  await supabase.from('brain_customer_profiles').upsert({
    customer_email: email,
    brain_customer_id: customer.id,
    product_affinities: profile.product_affinities,
    purchase_patterns: profile.purchase_patterns,
    restock_signals: profile.restock_signals,
    churn_risk: profile.churn_risk,
    sentiment: profile.sentiment,
    lifetime_value_tier: profile.lifetime_value_tier,
    recommended_products: profile.recommended_products,
    campaign_suggestions: profile.campaign_suggestions,
    ai_summary: profile.ai_summary,
    last_analysed: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, { onConflict: 'customer_email' });

  await supabase.from('brain_customers').update({
    lifecycle_stage: lifecycle,
    updated_at: new Date().toISOString()
  }).eq('email', email);

  const signalRows = [];
  for (const suggestion of (profile.campaign_suggestions || [])) {
    signalRows.push({
      signal_type: 'campaign_opportunity',
      customer_email: email,
      suggested_action: suggestion,
      suggested_message: `Re-engage ${customer.first_name} with: ${suggestion}`,
      priority: profile.churn_risk === 'high' ? 'high' : 'medium'
    });
  }
  for (const product of (profile.restock_signals || [])) {
    signalRows.push({
      signal_type: 'restock_signal',
      customer_email: email,
      product_name: product,
      suggested_action: `Send restock reminder for ${product}`,
      suggested_message: `Hey ${customer.first_name}, your ${product} supply might be running low. Stock up now.`,
      priority: 'high'
    });
  }
  if (signalRows.length > 0) {
    await supabase.from('brain_signals').insert(signalRows);
    for (const s of signalRows) {
      await obsidian.writeIntelligenceSignal(s).catch(e => console.error('Obsidian signal write failed:', e.message));
    }
  }

  await obsidian.writeCustomerNote({ ...customer, lifecycle_stage: lifecycle }, profile, orders);

  return { ...customer, lifecycle_stage: lifecycle, ...profile };
}

async function runBatchAnalysis() {
  const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

  const { data: customers } = await supabase.from('brain_customers')
    .select('email')
    .gte('last_order_date', cutoff);

  const toAnalyse = (customers || []).map(c => c.email);

  console.log(`Batch analysis: ${toAnalyse.length} customers to process`);
  for (let i = 0; i < toAnalyse.length; i += 5) {
    const batch = toAnalyse.slice(i, i + 5);
    await Promise.allSettled(batch.map(email => analyseCustomer(email)));
    console.log(`Batch analysis: processed ${Math.min(i + 5, toAnalyse.length)}/${toAnalyse.length}`);
    if (i + 5 < toAnalyse.length) await new Promise(r => setTimeout(r, 2000));
  }
}

async function generateDailyBrief() {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [ordersRes, campaignsRes, signalsRes, atRiskRes] = await Promise.all([
    supabase.from('brain_orders').select('*').gte('created_at', yesterday),
    supabase.from('brain_email_campaigns').select('*').order('sent_at', { ascending: false }).limit(3),
    supabase.from('brain_signals').select('*').eq('priority', 'high').eq('status', 'pending').limit(5),
    supabase.from('brain_customers').select('email, first_name, last_name, total_spent').eq('lifecycle_stage', 'at_risk').limit(10)
  ]);

  const orders = ordersRes.data || [];
  const campaigns = campaignsRes.data || [];
  const signals = signalsRes.data || [];
  const atRisk = atRiskRes.data || [];

  const totalRevenue = orders.reduce((sum, o) => sum + parseFloat(o.total || 0), 0);
  const context = `
Yesterday: ${orders.length} orders, $${totalRevenue.toFixed(2)} revenue
Last 3 campaigns: ${campaigns.map(c => `${c.name} (${c.open_rate}% open, $${c.revenue} revenue)`).join('; ')}
High priority signals: ${signals.length}
Newly at-risk customers: ${atRisk.map(c => `${c.first_name} ${c.last_name} ($${c.total_spent} LTV)`).join(', ') || 'None'}
`;

  let brief;
  try {
    const result = await callOpenRouter(
      VICI_CONTEXT + '\n\nWrite a concise daily business brief for Dom. Be direct, actionable, and conversational. No bullet hell. Plain paragraphs.',
      `Generate a "Good morning Dom" brief based on this data:\n${context}\n\nReturn JSON: { "brief": "full brief text here" }`
    );
    brief = result.brief || context;
  } catch (err) {
    console.error('Daily brief generation failed:', err.message);
    brief = `Good morning Dom. Yesterday: ${orders.length} orders, $${totalRevenue.toFixed(2)} revenue. ${signals.length} high-priority signals pending.`;
  }

  const date = new Date().toISOString().slice(0, 10);
  const fsp = require('fs').promises;
  const pathMod = require('path');
  const VAULT = process.env.OBSIDIAN_VAULT_PATH || './obsidian-vault';
  const filePath = pathMod.join(VAULT, 'Vici Brain', 'Intelligence', `daily-brief-${date}.md`);
  await fsp.mkdir(pathMod.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `---\ntags: [daily-brief]\ndate: ${date}\n---\n\n# Daily Brief — ${date}\n\n${brief}\n`, 'utf8');

  return brief;
}

module.exports = { analyseCustomer, runBatchAnalysis, generateDailyBrief, callOpenRouter };
