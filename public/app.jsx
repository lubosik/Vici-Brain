const { useState, useEffect, useCallback, useRef } = React;

// ---- HELPERS ----
function fmt(v) {
  return '$' + parseFloat(v || 0).toFixed(2);
}
function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return d; }
}
function timeAgo(d) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
function sourceIcon(source) {
  const icons = { woocommerce: '🛒', shipstation: '📦', omnisend: '📧', telnyx: '💬', system: '⚙️' };
  return icons[source] || '•';
}
function lifecycleBadgeClass(stage) {
  const map = { new: 'badge-new', active: 'badge-active', loyal: 'badge-loyal', champion: 'badge-champion', at_risk: 'badge-at_risk', lapsed: 'badge-lapsed' };
  return 'badge ' + (map[stage] || 'badge-standard');
}
function orderBadgeClass(status) {
  const map = { completed: 'badge-completed', processing: 'badge-processing', pending: 'badge-pending', cancelled: 'badge-cancelled', refunded: 'badge-refunded', 'on-hold': 'badge-on-hold' };
  return 'badge ' + (map[status] || 'badge-standard');
}
function ltvBadgeClass(tier) {
  const map = { standard: 'badge-standard', silver: 'badge-silver', gold: 'badge-gold', vip: 'badge-vip' };
  return 'badge ' + (map[tier] || 'badge-standard');
}
function openRateClass(rate) {
  const n = parseFloat(rate || 0);
  if (n >= 25) return 'good';
  if (n >= 15) return 'ok';
  return 'low';
}
function stockDotClass(status, qty) {
  if (status === 'outofstock') return 'outofstock';
  if (qty <= 5) return 'low';
  return 'instock';
}

// ---- API ----
async function api(path, options = {}) {
  const res = await fetch(path, { credentials: 'include', ...options });
  if (res.status === 401) throw Object.assign(new Error('Unauthorised'), { code: 401 });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---- LOGIN ----
function Login({ onLogin }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw })
      });
      onLogin();
    } catch (err) {
      setError(err.message === 'Invalid password' || err.code !== 401 ? 'Incorrect password. Try again.' : err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <h1>Vici Brain</h1>
          <p>Mission Control — Vici Peptides</p>
        </div>
        <form onSubmit={submit}>
          <label>Access Password</label>
          <input
            type="password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            placeholder="Enter password"
            autoFocus
          />
          <button type="submit" className="btn-primary" disabled={loading || !pw}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
          {error && <div className="login-error">{error}</div>}
        </form>
      </div>
    </div>
  );
}

// ---- STAT CARD ----
function StatCard({ label, value, sub, color }) {
  return (
    <div className={`stat-card ${color || ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

// ---- EVENT FEED ----
function EventFeed({ events, onSelectOrder }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Recent Orders</h3>
        <span>{events.length} orders</span>
      </div>
      <div className="event-feed">
        {events.length === 0 && <div className="empty">No orders yet</div>}
        {events.map((ev, i) => {
          const items = ev.payload?.items || [];
          const productStr = items.slice(0, 2).join(', ') + (items.length > 2 ? ` +${items.length - 2} more` : '');
          const statusColor = { completed: '#16a34a', processing: '#2563eb', 'on-hold': '#d97706', cancelled: '#dc2626', refunded: '#6b7280' }[ev.payload?.status] || '#6b7280';
          return (
            <div
              key={ev.id || i}
              className="event-item src-woocommerce"
              style={{ cursor: 'pointer' }}
              onClick={() => onSelectOrder && onSelectOrder(ev.payload?.order_id)}
            >
              <div className="event-icon">🛒</div>
              <div className="event-body">
                <div className="event-type">
                  Order #{ev.payload?.order_id}
                  <span style={{ marginLeft: 8, fontSize: '11px', color: statusColor, fontWeight: 600 }}>
                    {(ev.payload?.status || '').toUpperCase()}
                  </span>
                </div>
                <div className="event-detail" style={{ color: '#9ca3af' }}>
                  {ev.customer_email} · <strong style={{ color: '#e5e7eb' }}>${parseFloat(ev.payload?.total || 0).toFixed(2)}</strong>
                </div>
                <div className="event-detail" style={{ fontSize: '11px', color: '#6b7280', marginTop: 2 }}>
                  {productStr}
                </div>
              </div>
              <div className="event-time">{timeAgo(ev.created_at)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- ORDER DETAIL MODAL ----
function OrderDetailModal({ orderId, onClose }) {
  const [order, setOrder] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!orderId) return;
    setLoading(true);
    api(`/api/orders?status=all&search=${orderId}`)
      .then(res => {
        const found = (res.orders || res || []).find(o => String(o.woo_order_id) === String(orderId));
        setOrder(found || null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [orderId]);

  if (!orderId) return null;
  const items = order ? (Array.isArray(order.items) ? order.items : []) : [];
  const addr = order?.shipping_address || {};

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div style={{ background:'#1a1a1a', border:'1px solid #2e2e2e', borderRadius:12, padding:32, width:480, maxHeight:'80vh', overflowY:'auto', position:'relative' }} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={{ position:'absolute', top:16, right:16, background:'none', border:'none', color:'#6b7280', fontSize:20, cursor:'pointer' }}>✕</button>
        {loading ? (
          <div className="loading"><div className="spinner"></div>Loading order...</div>
        ) : !order ? (
          <div className="empty">Order #{orderId} not found in local DB yet</div>
        ) : (
          <>
            <h2 style={{ margin:'0 0 4px', color:'#e5e7eb' }}>Order #{order.woo_order_id}</h2>
            <div style={{ marginBottom:16, display:'flex', gap:8, flexWrap:'wrap' }}>
              <span className={orderBadgeClass(order.status)}>{order.status}</span>
              <span style={{ color:'#22c55e', fontWeight:700, fontSize:18 }}>${parseFloat(order.total||0).toFixed(2)}</span>
              <span style={{ color:'#6b7280', fontSize:13 }}>{fmtDate(order.created_at)}</span>
            </div>
            <div style={{ marginBottom:16 }}>
              <div style={{ color:'#9ca3af', fontSize:12, marginBottom:4 }}>CUSTOMER</div>
              <div style={{ color:'#e5e7eb' }}>{order.customer_email}</div>
              {order.customer_phone && <div style={{ color:'#6b7280' }}>{order.customer_phone}</div>}
            </div>
            <div style={{ marginBottom:16 }}>
              <div style={{ color:'#9ca3af', fontSize:12, marginBottom:4 }}>ITEMS</div>
              {items.length === 0 ? <div style={{ color:'#6b7280' }}>—</div> : items.map((item, i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid #242424' }}>
                  <span style={{ color:'#e5e7eb' }}>{item.quantity || 1}× {item.name}</span>
                  <span style={{ color:'#9ca3af' }}>${parseFloat(item.price||0).toFixed(2)}</span>
                </div>
              ))}
            </div>
            {(order.tracking_number || order.carrier) && (
              <div style={{ marginBottom:16 }}>
                <div style={{ color:'#9ca3af', fontSize:12, marginBottom:4 }}>SHIPPING</div>
                <div style={{ color:'#e5e7eb' }}>{order.carrier} — {order.tracking_number}</div>
                <div style={{ color:'#6b7280', fontSize:12 }}>Status: {order.shipment_status || '—'}</div>
              </div>
            )}
            {addr.address_1 && (
              <div>
                <div style={{ color:'#9ca3af', fontSize:12, marginBottom:4 }}>SHIP TO</div>
                <div style={{ color:'#6b7280', fontSize:13, lineHeight:1.6 }}>
                  {addr.first_name} {addr.last_name}<br/>
                  {addr.address_1}{addr.address_2 ? `, ${addr.address_2}` : ''}<br/>
                  {addr.city}, {addr.state} {addr.postcode}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---- SIGNAL MINI ----
function SignalMini({ signal, onAction, onDismiss }) {
  return (
    <div className={`signal-card priority-${signal.priority}`}>
      <div className="signal-header">
        <span className="signal-type">{signal.signal_type?.replace(/_/g, ' ')}</span>
        <span className="badge badge-at_risk" style={{ fontSize: '10px' }}>{signal.priority}</span>
      </div>
      <div className="signal-email">{signal.customer_email}</div>
      <div className="signal-action">{signal.suggested_action}</div>
      <div className="signal-actions">
        <button className="btn-action" onClick={() => onAction(signal.id)}>Action</button>
        <button className="btn-dismiss" onClick={() => onDismiss(signal.id)}>Dismiss</button>
      </div>
    </div>
  );
}

// ---- OVERVIEW TAB ----
function OverviewTab({ onAuthError }) {
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const esRef = useRef(null);

  const loadData = useCallback(async () => {
    try {
      const [s, e, sig] = await Promise.all([
        api('/api/dashboard/stats'),
        api('/api/dashboard/feed?limit=50'),
        api('/api/dashboard/signals?status=pending&priority=high')
      ]);
      setStats(s);
      setEvents(e);
      setSignals(sig.slice(0, 5));
      setLoading(false);
    } catch (err) {
      if (err.code === 401) onAuthError();
      setLoading(false);
    }
  }, [onAuthError]);

  useEffect(() => {
    loadData();
    // SSE
    const es = new EventSource('/api/events/stream', { withCredentials: true });
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        setEvents(prev => [event, ...prev].slice(0, 50));
        if (event.event_type === 'order.created') {
          setStats(prev => prev ? {
            ...prev,
            today: { ...prev.today, orders: (prev.today.orders || 0) + 1, revenue: (parseFloat(prev.today.revenue || 0) + parseFloat(event.payload?.total || 0)).toFixed(2) }
          } : prev);
        }
      } catch {}
    };
    es.onerror = () => {};
    return () => { es.close(); };
  }, [loadData]);

  async function handleAction(id) {
    try {
      await api(`/api/signals/${id}/action`, { method: 'POST' });
      setSignals(prev => prev.filter(s => s.id !== id));
    } catch (err) { if (err.code === 401) onAuthError(); }
  }
  async function handleDismiss(id) {
    try {
      await api(`/api/signals/${id}/dismiss`, { method: 'POST' });
      setSignals(prev => prev.filter(s => s.id !== id));
    } catch (err) { if (err.code === 401) onAuthError(); }
  }

  if (loading) return <div className="loading"><div className="spinner"></div>Loading...</div>;
  if (!stats) return <div className="empty">Failed to load stats</div>;

  const lc = stats.lifecycle || {};

  return (
    <div>
      <OrderDetailModal orderId={selectedOrderId} onClose={() => setSelectedOrderId(null)} />
      <div className="stats-grid">
        <StatCard label="Today Revenue" value={fmt(stats.today?.revenue)} sub={`${stats.today?.orders || 0} orders today`} color="green" />
        <StatCard label="Month Revenue" value={fmt(stats.this_month?.revenue)} sub={`${stats.this_month?.orders || 0} orders this month`} />
        <StatCard label="Total Customers" value={(stats.all_time?.total_customers || 0).toLocaleString()} sub={`${lc.champion || 0} champions`} color="blue" />
        <StatCard label="Pending Signals" value={stats.signals?.total || 0} sub={`${stats.signals?.high || 0} high priority`} color={stats.signals?.high > 0 ? 'amber' : ''} />
      </div>

      <div className="two-col">
        <EventFeed events={events} onSelectOrder={setSelectedOrderId} />
        <div>
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-header"><h3>Lifecycle Breakdown</h3></div>
            <div style={{ padding: '16px 20px' }}>
              {[['champion', 'Champions'], ['loyal', 'Loyal'], ['active', 'Active'], ['new', 'New'], ['at_risk', 'At Risk'], ['lapsed', 'Lapsed']].map(([key, label]) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, alignItems: 'center' }}>
                  <span className={lifecycleBadgeClass(key)}>{label}</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{lc[key] || 0}</span>
                </div>
              ))}
            </div>
          </div>

          {stats.last_campaign && (
            <div className="panel">
              <div className="panel-header"><h3>Last Campaign</h3></div>
              <div style={{ padding: '16px 20px' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{stats.last_campaign.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>{fmtDate(stats.last_campaign.sent_at)}</div>
                <div style={{ display: 'flex', gap: 20 }}>
                  <div><div style={{ fontSize: 11, color: 'var(--text-dim)' }}>OPEN RATE</div><div style={{ fontSize: 20, fontWeight: 700 }}>{stats.last_campaign.open_rate || 0}%</div></div>
                  <div><div style={{ fontSize: 11, color: 'var(--text-dim)' }}>REVENUE</div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(stats.last_campaign.revenue)}</div></div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {signals.length > 0 && (
        <div>
          <div className="section-heading">High Priority Signals <small>({signals.length})</small></div>
          <div className="three-col">
            {signals.map(s => <SignalMini key={s.id} signal={s} onAction={handleAction} onDismiss={handleDismiss} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- CUSTOMER DETAIL PANEL ----
function CustomerPanel({ email, onClose, onAuthError }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analysing, setAnalysing] = useState(false);

  useEffect(() => {
    setLoading(true);
    api(`/api/customers/${encodeURIComponent(email)}`)
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { if (err.code === 401) onAuthError(); setLoading(false); });
  }, [email, onAuthError]);

  async function handleAnalyse() {
    setAnalysing(true);
    try {
      const res = await api(`/api/customers/${encodeURIComponent(email)}/analyse`, { method: 'POST' });
      setData(prev => ({ ...prev, profile: res.profile }));
    } catch (err) { if (err.code === 401) onAuthError(); }
    finally { setAnalysing(false); }
  }

  return (
    <div className="customer-panel-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="customer-panel">
        <div className="cp-header">
          <h2>{data?.customer ? `${data.customer.first_name || ''} ${data.customer.last_name || ''}`.trim() || email : email}</h2>
          <button className="cp-close" onClick={onClose}>×</button>
        </div>
        {loading ? <div className="loading"><div className="spinner"></div>Loading...</div> : data ? (
          <>
            <div className="cp-section">
              <h4>Customer Info</h4>
              <div className="cp-row"><span>Email</span><span>{data.customer?.email}</span></div>
              <div className="cp-row"><span>Phone</span><span>{data.customer?.phone || '—'}</span></div>
              <div className="cp-row"><span>Lifecycle</span><span><span className={lifecycleBadgeClass(data.customer?.lifecycle_stage)}>{data.customer?.lifecycle_stage || 'new'}</span></span></div>
              <div className="cp-row"><span>Total Spent</span><span>{fmt(data.customer?.total_spent)}</span></div>
              <div className="cp-row"><span>Total Orders</span><span>{data.customer?.total_orders || 0}</span></div>
              <div className="cp-row"><span>Avg Order</span><span>{fmt(data.customer?.avg_order_value)}</span></div>
              <div className="cp-row"><span>Last Order</span><span>{fmtDate(data.customer?.last_order_date)}</span></div>
            </div>
            {data.profile && (
              <div className="cp-section">
                <h4>AI Profile</h4>
                <div className="cp-row">
                  <span>LTV Tier</span>
                  <span><span className={ltvBadgeClass(data.profile?.lifetime_value_tier)}>{data.profile?.lifetime_value_tier || 'standard'}</span></span>
                </div>
                <div className="cp-row">
                  <span>Churn Risk</span>
                  <span><span className={`churn-dot ${data.profile?.churn_risk || 'low'}`}>{data.profile?.churn_risk || 'low'}</span></span>
                </div>
                <div className="cp-row"><span>Sentiment</span><span>{data.profile?.sentiment || '—'}</span></div>
                {data.profile?.product_affinities?.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>PRODUCT AFFINITIES</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {data.profile.product_affinities.map((p, i) => <span key={i} className="badge badge-standard" style={{ fontSize: 11 }}>{p}</span>)}
                    </div>
                  </div>
                )}
                {data.profile?.ai_summary && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>AI SUMMARY</div>
                    <div className="cp-summary">{data.profile.ai_summary}</div>
                  </div>
                )}
              </div>
            )}
            {data.orders?.length > 0 && (
              <div className="cp-section">
                <h4>Recent Orders</h4>
                {data.orders.map(o => (
                  <div key={o.id} className="cp-order-item">
                    <div className="cp-order-num">Order #{o.woo_order_id} — {fmt(o.total)}</div>
                    <div className="cp-order-detail">{fmtDate(o.created_at)} · <span className={orderBadgeClass(o.status)} style={{ fontSize: 10 }}>{o.status}</span></div>
                    {Array.isArray(o.items) && o.items.length > 0 && (
                      <div className="cp-order-detail" style={{ marginTop: 2 }}>{o.items.map(i => i.name).join(', ')}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {data.signals?.length > 0 && (
              <div className="cp-section">
                <h4>Pending Signals ({data.signals.length})</h4>
                {data.signals.map(s => (
                  <div key={s.id} style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    {s.suggested_action}
                  </div>
                ))}
              </div>
            )}
            <div style={{ padding: 16 }}>
              <button className="btn-analyse" onClick={handleAnalyse} disabled={analysing}>
                {analysing ? 'Analysing...' : 'Run AI Analysis'}
              </button>
            </div>
          </>
        ) : <div className="empty">Customer not found</div>}
      </div>
    </div>
  );
}

// ---- CUSTOMERS TAB ----
function CustomersTab({ onAuthError }) {
  const [customers, setCustomers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [lifecycle, setLifecycle] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const searchRef = useRef(null);

  const load = useCallback(async (pg = 1, lc = lifecycle, q = search) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: pg });
      if (lc) params.set('lifecycle', lc);
      if (q) params.set('search', q);
      const data = await api(`/api/customers?${params}`);
      setCustomers(data.customers || []);
      setTotal(data.total || 0);
      setPage(pg);
    } catch (err) { if (err.code === 401) onAuthError(); }
    finally { setLoading(false); }
  }, [lifecycle, search, onAuthError]);

  useEffect(() => { load(1, lifecycle, search); }, [lifecycle]);

  useEffect(() => {
    const t = setTimeout(() => load(1, lifecycle, search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const LIFECYCLES = ['', 'champion', 'loyal', 'active', 'new', 'at_risk', 'lapsed'];
  const LIFECYCLE_LABELS = { '': 'All', champion: 'Champions', loyal: 'Loyal', active: 'Active', new: 'New', at_risk: 'At Risk', lapsed: 'Lapsed' };
  const totalPages = Math.ceil(total / 50);

  return (
    <div>
      {selected && <CustomerPanel email={selected} onClose={() => setSelected(null)} onAuthError={onAuthError} />}
      <div className="section-heading">Customers <small>({total.toLocaleString()} total)</small></div>
      <div className="filter-row">
        {LIFECYCLES.map(lc => (
          <button key={lc} className={`filter-btn ${lifecycle === lc ? 'active' : ''}`} onClick={() => setLifecycle(lc)}>
            {LIFECYCLE_LABELS[lc]}
          </button>
        ))}
        <input
          ref={searchRef}
          className="search-input"
          placeholder="Search name / email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      {loading ? <div className="loading"><div className="spinner"></div>Loading...</div> : (
        <div className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Lifecycle</th>
                  <th>Total Spent</th>
                  <th>Orders</th>
                  <th>Avg Order</th>
                  <th>Last Order</th>
                  <th>Churn Risk</th>
                </tr>
              </thead>
              <tbody>
                {customers.length === 0 && (
                  <tr><td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 40 }}>No customers found</td></tr>
                )}
                {customers.map(c => (
                  <tr key={c.id} onClick={() => setSelected(c.email)}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{c.first_name || ''} {c.last_name || ''}</div>
                      <div className="small muted">{c.email}</div>
                    </td>
                    <td><span className={lifecycleBadgeClass(c.lifecycle_stage)}>{c.lifecycle_stage || 'new'}</span></td>
                    <td style={{ fontWeight: 600 }}>{fmt(c.total_spent)}</td>
                    <td>{c.total_orders || 0}</td>
                    <td className="muted">{fmt(c.avg_order_value)}</td>
                    <td className="muted">{fmtDate(c.last_order_date)}</td>
                    <td>
                      <span className={`churn-dot ${c.churn_risk || 'low'}`}>{c.churn_risk || 'low'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>Page {page} of {totalPages || 1}</span>
            <button className="btn-page" disabled={page <= 1} onClick={() => load(page - 1)}>Prev</button>
            <button className="btn-page" disabled={page >= totalPages} onClick={() => load(page + 1)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- ORDERS TAB ----
function OrdersTab({ onAuthError }) {
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [newIds, setNewIds] = useState(new Set());

  const load = useCallback(async (pg = 1, st = status) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: pg });
      if (st) params.set('status', st);
      const data = await api(`/api/orders?${params}`);
      setOrders(data.orders || []);
      setTotal(data.total || 0);
      setPage(pg);
    } catch (err) { if (err.code === 401) onAuthError(); }
    finally { setLoading(false); }
  }, [status, onAuthError]);

  useEffect(() => { load(1, status); }, [status]);

  const STATUSES = ['', 'processing', 'completed', 'pending', 'on-hold', 'cancelled', 'refunded'];
  const STATUS_LABELS = { '': 'All', processing: 'Processing', completed: 'Completed', pending: 'Pending', 'on-hold': 'On Hold', cancelled: 'Cancelled', refunded: 'Refunded' };
  const totalPages = Math.ceil(total / 50);

  return (
    <div>
      <div className="section-heading">Orders <small>({total.toLocaleString()} total)</small></div>
      <div className="filter-row">
        {STATUSES.map(s => (
          <button key={s} className={`filter-btn ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)}>
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>
      {loading ? <div className="loading"><div className="spinner"></div>Loading...</div> : (
        <div className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Items</th>
                  <th>Tracking</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 && (
                  <tr><td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 40 }}>No orders found</td></tr>
                )}
                {orders.map(o => (
                  <tr key={o.id} className={newIds.has(o.id) ? 'new-row' : ''}>
                    <td style={{ fontWeight: 600, color: 'var(--blue-light)' }}>#{o.woo_order_id}</td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{o.customer_email}</div>
                      <div className="small muted">{o.customer_phone || ''}</div>
                    </td>
                    <td><span className={orderBadgeClass(o.status)}>{o.status}</span></td>
                    <td style={{ fontWeight: 600 }}>{fmt(o.total)}</td>
                    <td className="muted small">
                      {Array.isArray(o.items) ? o.items.map(i => i.name).join(', ').slice(0, 40) : '—'}
                    </td>
                    <td className="muted small">{o.tracking_number ? `${o.carrier || ''} ${o.tracking_number}` : '—'}</td>
                    <td className="muted small">{fmtDate(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>Page {page} of {totalPages || 1}</span>
            <button className="btn-page" disabled={page <= 1} onClick={() => load(page - 1)}>Prev</button>
            <button className="btn-page" disabled={page >= totalPages} onClick={() => load(page + 1)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- CAMPAIGNS TAB ----
function CampaignsTab({ onAuthError }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/api/campaigns?limit=20')
      .then(d => { setCampaigns(d); setLoading(false); })
      .catch(err => { if (err.code === 401) onAuthError(); setLoading(false); });
  }, [onAuthError]);

  if (loading) return <div className="loading"><div className="spinner"></div>Loading...</div>;

  return (
    <div>
      <div className="section-heading">Email Campaigns <small>({campaigns.length})</small></div>
      {campaigns.length === 0 && <div className="empty">No campaigns synced yet</div>}
      {campaigns.map(c => {
        const openRateFill = Math.min(parseFloat(c.open_rate || 0), 100);
        const clickRateFill = Math.min(parseFloat(c.click_rate || 0), 100);
        return (
          <div key={c.id} className="campaign-card">
            <div className="campaign-name">{c.name}</div>
            <div className="campaign-subject">{c.subject}</div>
            <div className="campaign-metrics">
              <div className="metric-block">
                <div className="metric-label">Recipients</div>
                <div className="metric-val">{(c.recipients || 0).toLocaleString()}</div>
              </div>
              <div className="metric-block">
                <div className="metric-label">Opens</div>
                <div className="metric-val">{(c.opens || 0).toLocaleString()}</div>
              </div>
              <div className="metric-block">
                <div className="metric-label">Clicks</div>
                <div className="metric-val">{(c.clicks || 0).toLocaleString()}</div>
              </div>
              <div className="metric-block">
                <div className="metric-label">Revenue</div>
                <div className="metric-val">{fmt(c.revenue)}</div>
              </div>
            </div>
            <div className="open-rate-bar-wrap">
              <div className="open-rate-bar-label">
                <span>Open Rate</span>
                <span>{c.open_rate || 0}%</span>
              </div>
              <div className="open-rate-bar-track">
                <div className={`open-rate-bar-fill ${openRateClass(c.open_rate)}`} style={{ width: `${openRateFill}%` }}></div>
              </div>
            </div>
            <div className="open-rate-bar-wrap" style={{ marginTop: 8 }}>
              <div className="open-rate-bar-label">
                <span>Click Rate</span>
                <span>{c.click_rate || 0}%</span>
              </div>
              <div className="open-rate-bar-track">
                <div className={`open-rate-bar-fill ${openRateClass(c.click_rate)}`} style={{ width: `${clickRateFill}%` }}></div>
              </div>
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-dim)' }}>Sent {fmtDate(c.sent_at)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ---- INTELLIGENCE TAB ----
function IntelligenceTab({ onAuthError }) {
  const [signals, setSignals] = useState([]);
  const [brief, setBrief] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');

  useEffect(() => {
    const params = new URLSearchParams();
    if (filter) params.set('status', filter);
    Promise.all([
      api(`/api/dashboard/signals?${params}`),
      fetch(`/Users/ghost/vici-brain/obsidian-vault/Vici Brain/Intelligence/daily-brief-${new Date().toISOString().slice(0,10)}.md`).then(r => r.text()).catch(() => '')
    ]).then(([sigs, b]) => {
      setSignals(sigs);
      // Try to extract brief content
      if (b && b.includes('# Daily Brief')) {
        const match = b.split('\n\n').slice(2).join('\n\n');
        setBrief(match);
      }
      setLoading(false);
    }).catch(err => { if (err.code === 401) onAuthError(); setLoading(false); });
  }, [filter, onAuthError]);

  async function handleAction(id) {
    try {
      await api(`/api/signals/${id}/action`, { method: 'POST' });
      setSignals(prev => prev.filter(s => s.id !== id));
    } catch (err) { if (err.code === 401) onAuthError(); }
  }
  async function handleDismiss(id) {
    try {
      await api(`/api/signals/${id}/dismiss`, { method: 'POST' });
      setSignals(prev => prev.filter(s => s.id !== id));
    } catch (err) { if (err.code === 401) onAuthError(); }
  }

  const urgent = signals.filter(s => s.priority === 'urgent');
  const high = signals.filter(s => s.priority === 'high');
  const medium = signals.filter(s => s.priority === 'medium');
  const low = signals.filter(s => s.priority === 'low');

  if (loading) return <div className="loading"><div className="spinner"></div>Loading...</div>;

  return (
    <div>
      {brief && (
        <div className="brief-card">
          <h3>Today's Brief</h3>
          <div className="brief-text">{brief}</div>
        </div>
      )}
      <div className="section-heading">Intelligence Signals <small>({signals.length})</small></div>
      <div className="filter-row">
        {['pending', 'actioned', 'dismissed', ''].map((s, i) => (
          <button key={i} className={`filter-btn ${filter === s ? 'active' : ''}`} onClick={() => setFilter(s)}>
            {s || 'All'}
          </button>
        ))}
      </div>
      {signals.length === 0 && <div className="empty">No signals</div>}
      {urgent.length > 0 && (
        <>
          <div className="section-heading" style={{ color: 'var(--red-light)', fontSize: 12 }}>URGENT</div>
          {urgent.map(s => <SignalMini key={s.id} signal={s} onAction={handleAction} onDismiss={handleDismiss} />)}
        </>
      )}
      {high.length > 0 && (
        <>
          <div className="section-heading" style={{ color: 'var(--amber-light)', fontSize: 12 }}>HIGH PRIORITY</div>
          {high.map(s => <SignalMini key={s.id} signal={s} onAction={handleAction} onDismiss={handleDismiss} />)}
        </>
      )}
      {medium.length > 0 && (
        <>
          <div className="section-heading" style={{ color: 'var(--blue-light)', fontSize: 12 }}>MEDIUM</div>
          {medium.map(s => <SignalMini key={s.id} signal={s} onAction={handleAction} onDismiss={handleDismiss} />)}
        </>
      )}
      {low.length > 0 && (
        <>
          <div className="section-heading" style={{ fontSize: 12 }}>LOW</div>
          {low.map(s => <SignalMini key={s.id} signal={s} onAction={handleAction} onDismiss={handleDismiss} />)}
        </>
      )}
    </div>
  );
}

// ---- PRODUCTS TAB ----
function ProductsTab({ onAuthError }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/api/products/top')
      .then(d => { setProducts(d); setLoading(false); })
      .catch(err => { if (err.code === 401) onAuthError(); setLoading(false); });
  }, [onAuthError]);

  if (loading) return <div className="loading"><div className="spinner"></div>Loading...</div>;

  return (
    <div>
      <div className="section-heading">Products <small>({products.length})</small></div>
      {products.length === 0 && <div className="empty">No products synced yet</div>}
      <div className="products-grid">
        {products.map(p => (
          <div key={p.id} className="product-card">
            <div className="product-name">{p.name || 'Unnamed Product'}</div>
            <div className="product-sku">SKU: {p.sku || '—'}</div>
            <div className="product-stats">
              <div className="product-stat-row">
                <span>Price</span>
                <span>{fmt(p.price)}</span>
              </div>
              <div className="product-stat-row">
                <span>Total Sold</span>
                <span>{(p.total_sold || 0).toLocaleString()} units</span>
              </div>
              <div className="product-stat-row">
                <span>Revenue</span>
                <span>{fmt(p.revenue)}</span>
              </div>
              <div className="product-stat-row">
                <span>Stock</span>
                <span>
                  <span className={`stock-dot ${stockDotClass(p.stock_status, p.stock_quantity)}`}>
                    {p.stock_quantity != null ? p.stock_quantity : '—'} {p.stock_status || ''}
                  </span>
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- MAIN APP ----
function App() {
  const [authed, setAuthed] = useState(null); // null = checking
  const [tab, setTab] = useState('overview');
  const [signalCount, setSignalCount] = useState(0);

  useEffect(() => {
    // Check if already authed by pinging a protected route
    api('/api/dashboard/stats')
      .then(() => setAuthed(true))
      .catch(err => { setAuthed(err.code === 401 ? false : true); });
  }, []);

  useEffect(() => {
    if (!authed) return;
    api('/api/dashboard/signals?status=pending')
      .then(sigs => setSignalCount(sigs.length))
      .catch(() => {});
  }, [authed, tab]);

  function handleAuthError() {
    setAuthed(false);
  }

  async function handleLogout() {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    setAuthed(false);
  }

  if (authed === null) {
    return <div className="loading" style={{ minHeight: '100vh' }}><div className="spinner"></div>Loading...</div>;
  }
  if (!authed) {
    return <Login onLogin={() => setAuthed(true)} />;
  }

  const TABS = [
    { id: 'overview', label: 'Overview', icon: '🏠' },
    { id: 'customers', label: 'Customers', icon: '👥' },
    { id: 'orders', label: 'Orders', icon: '📦' },
    { id: 'campaigns', label: 'Campaigns', icon: '📧' },
    { id: 'intelligence', label: 'Intelligence', icon: '🧠' },
    { id: 'products', label: 'Products', icon: '🧪' }
  ];

  return (
    <div className="app-shell">
      <nav className="nav">
        <div className="nav-brand">Vici Brain</div>
        <div className="nav-tabs">
          {TABS.map(t => (
            <button key={t.id} className={`nav-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              {t.icon} {t.label}
              {t.id === 'intelligence' && signalCount > 0 && (
                <span className="nav-badge">{signalCount}</span>
              )}
            </button>
          ))}
        </div>
        <div className="nav-actions">
          <button className="btn-sm" onClick={handleLogout}>Sign Out</button>
        </div>
      </nav>
      <main className="main">
        {tab === 'overview' && <OverviewTab onAuthError={handleAuthError} />}
        {tab === 'customers' && <CustomersTab onAuthError={handleAuthError} />}
        {tab === 'orders' && <OrdersTab onAuthError={handleAuthError} />}
        {tab === 'campaigns' && <CampaignsTab onAuthError={handleAuthError} />}
        {tab === 'intelligence' && <IntelligenceTab onAuthError={handleAuthError} />}
        {tab === 'products' && <ProductsTab onAuthError={handleAuthError} />}
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
