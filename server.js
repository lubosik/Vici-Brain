'use strict';
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const app = express();
app.set('trust proxy', 1); // Railway sits behind a reverse proxy
const sseClients = new Set();

function broadcastEvent(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  sseClients.forEach(c => {
    try { c.write(data); } catch { sseClients.delete(c); }
  });
}
app.locals.broadcastEvent = broadcastEvent;

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.APP_URL, credentials: true }));
app.use('/webhooks', express.raw({ type: '*/*' }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  return res.status(401).json({ error: 'Unauthorised' });
}

app.use('/webhooks', require('./routes/webhooks'));
app.use('/auth', require('./routes/auth'));
app.use('/api/events/stream', requireAuth, require('./routes/sse')(sseClients));
app.use('/api', requireAuth, require('./routes/dashboard'));

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  const supabase = require('./db');
  const { error } = await supabase.from('brain_customers').select('id').limit(1);
  if (error) {
    console.error('DB connection failed:', error.message);
    // Don't exit — Railway healthcheck needs the server to be up
  }
  console.log(`Vici Brain running on port ${PORT}`);
  console.log(`Supabase: ${process.env.SUPABASE_URL?.slice(0, 30)}...`);

  require('./jobs/scheduler');

  setTimeout(async () => {
    try {
      const woo = require('./sync/woocommerce');
      await woo.syncRecentOrders();
      await require('./sync/omnisend').syncAll();
      await require('./sync/shipstation').syncShipments();
      console.log('Initial sync complete');
      woo.syncHistorical().catch(e => console.error('Historical sync error:', e.message));
    } catch (err) {
      console.error('Initial sync error:', err.message);
    }
  }, 5000);
});
