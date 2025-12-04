import { useEffect, useMemo, useState } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import 'chart.js/auto';
import { format, subDays } from 'date-fns';
import './App.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';
const DEFAULT_RESOURCES = ['customers', 'orders', 'products'];
const resourceLabels = {
  customers: 'Customers',
  orders: 'Orders',
  products: 'Products',
};

const buildErrorMessage = async (res) => {
  try {
    const data = await res.json();
    const parts = [data?.message, data?.error, data?.details && JSON.stringify(data.details)];
    return parts.filter(Boolean).join(' - ') || res.statusText || 'Request failed';
  } catch (err) {
    return res.statusText || 'Request failed';
  }
};

const defaultStart = format(subDays(new Date(), 30), 'yyyy-MM-dd');
const defaultEnd = format(new Date(), 'yyyy-MM-dd');

function App() {
  const [userEmail, setUserEmail] = useState(localStorage.getItem('xenoEmail') || '');
  const [authInput, setAuthInput] = useState(userEmail);
  const [shops, setShops] = useState([]);
  const [activeShopId, setActiveShopId] = useState('');
  const [insights, setInsights] = useState(null);
  const [events, setEvents] = useState([]);
  const [ordersByDate, setOrdersByDate] = useState([]);
  const [topCustomers, setTopCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [registerForm, setRegisterForm] = useState({
    shopDomain: '',
    accessToken: '',
    name: '',
    apiVersion: '',
  });
  const [resources, setResources] = useState(DEFAULT_RESOURCES);
  const [customEvent, setCustomEvent] = useState({
    topic: 'checkout_started',
    payload: '{"cart_value":120,"currency":"USD"}',
  });
  const [dateRange, setDateRange] = useState({ start: defaultStart, end: defaultEnd });

  const isAuthed = Boolean(userEmail);

  const api = async (path, options = {}) => {
    const email = options.userEmail || userEmail;
    if (!email) throw new Error('Sign in with email to use the dashboard');
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', 'X-User-Email': email, ...(options.headers || {}) },
      ...options,
    });
    if (!res.ok) {
      throw new Error(await buildErrorMessage(res));
    }
    return res.json();
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!authInput) {
      setMessage('Enter an email to continue');
      return;
    }
    const nextEmail = authInput.trim().toLowerCase();
    localStorage.setItem('xenoEmail', nextEmail);
    setUserEmail(nextEmail);
    setMessage('Signed in');
    await loadShops(nextEmail);
  };

  const handleLogout = () => {
    localStorage.removeItem('xenoEmail');
    setUserEmail('');
    setShops([]);
    setActiveShopId('');
    setInsights(null);
    setEvents([]);
    setOrdersByDate([]);
    setTopCustomers([]);
  };

  const loadShops = async (emailOverride) => {
    const email = emailOverride || userEmail;
    if (!email) return;
    const data = await api('/shops', { userEmail: email });
    setShops(data);
    if (!activeShopId && data.length) {
      handleSelectShop(data[0]._id);
    }
  };

  useEffect(() => {
    if (isAuthed) {
      loadShops().catch((err) => setMessage(err.message));
    }
  }, [isAuthed]);

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      await api('/shops/register', { method: 'POST', body: JSON.stringify(registerForm) });
      setRegisterForm({ shopDomain: '', accessToken: '', name: '', apiVersion: '' });
      await loadShops();
      setMessage('Shop registered. You can sync now.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadInsights = async (shopId) => {
    const data = await api(`/insights/${shopId}/summary`);
    setInsights(data);
    return data;
  };

  const loadEvents = async (shopId) => {
    const data = await api(`/events/${shopId}?limit=25`);
    setEvents(data);
  };

  const loadOrdersByDate = async (shopId, start = dateRange.start, end = dateRange.end) => {
    const data = await api(`/insights/${shopId}/orders-by-date?start=${start}&end=${end}`);
    setOrdersByDate(data);
  };

  const loadTopCustomers = async (shopId) => {
    const data = await api(`/insights/${shopId}/top-customers?limit=5`);
    setTopCustomers(data);
  };

  const handleSelectShop = async (shopId) => {
    setActiveShopId(shopId);
    setInsights(null);
    setEvents([]);
    setMessage('');
    try {
      await Promise.all([loadInsights(shopId), loadEvents(shopId), loadOrdersByDate(shopId), loadTopCustomers(shopId)]);
    } catch (err) {
      setMessage(err.message);
    }
  };

  const toggleResource = (resource) => {
    setResources((current) =>
      current.includes(resource) ? current.filter((r) => r !== resource) : [...current, resource]
    );
  };

  const triggerSync = async (shopId) => {
    if (!resources.length) {
      setMessage('Select at least one resource to sync');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const { summary } = await api(`/shops/${shopId}/sync`, {
        method: 'POST',
        body: JSON.stringify({ resources }),
      });
      setMessage(
        `Synced: ${Object.entries(summary)
          .map(([key, value]) => `${key}(${value.pulled || 0})`)
          .join(', ')}`
      );
      await Promise.all([loadInsights(shopId), loadOrdersByDate(shopId), loadTopCustomers(shopId)]);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  const sendCustomEvent = async () => {
    if (!activeShopId) {
      setMessage('Select a shop first');
      return;
    }

    let payload;
    try {
      payload = JSON.parse(customEvent.payload || '{}');
    } catch (err) {
      setMessage('Payload must be valid JSON');
      return;
    }

    setLoading(true);
    setMessage('');
    try {
      await api(`/events/${activeShopId}`, {
        method: 'POST',
        body: JSON.stringify({ topic: customEvent.topic, payload }),
      });
      setMessage('Custom event recorded');
      await loadEvents(activeShopId);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  const trendValue = (metric) => {
    const change = metric?.deltaPct;
    if (change === null || change === undefined) return 'n/a';
    const direction = Number(change) >= 0 ? 'up' : 'down';
    return `${direction} ${Math.abs(Number(change)).toFixed(1)}% vs prior 7d`;
  };

  const activeShop = useMemo(() => shops.find((s) => s._id === activeShopId), [activeShopId, shops]);
  const orderLabels = ordersByDate.map((row) => row.date);

  const ordersChartData = {
    labels: orderLabels,
    datasets: [
      {
        label: 'Orders',
        data: ordersByDate.map((row) => row.orders),
        borderColor: '#a855f7',
        backgroundColor: 'rgba(168, 85, 247, 0.2)',
        tension: 0.3,
        yAxisID: 'y',
      },
      {
        label: 'Revenue',
        data: ordersByDate.map((row) => row.revenue),
        borderColor: '#22d3ee',
        backgroundColor: 'rgba(34, 211, 238, 0.2)',
        tension: 0.3,
        yAxisID: 'y1',
      },
    ],
  };

const ordersChartOptions = {
    responsive: true,
    plugins: {
      legend: { position: 'top', labels: { color: '#cbd5e1' } },
    },
    scales: {
      x: { ticks: { color: '#94a3b8' }, grid: { color: '#1f2937' } },
      y: { ticks: { color: '#94a3b8' }, grid: { color: '#1f2937' }, title: { display: true, text: 'Orders' } },
      y1: {
        position: 'right',
        ticks: { color: '#22d3ee' },
        grid: { drawOnChartArea: false },
        title: { display: true, text: 'Revenue' },
      },
    },
  };

  const topCustomersData = {
    labels: topCustomers.map((c) => c.email || 'Unknown'),
    datasets: [
      {
        label: 'Total Spend',
        data: topCustomers.map((c) => c.totalSpend),
        backgroundColor: 'rgba(34, 197, 94, 0.5)',
        borderColor: '#22c55e',
      },
    ],
  };

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Xeno | Shopify DataOps</p>
          <h1>Multi-tenant Shopify Ingestion & Insights</h1>
          <p className="lede">
            Register a Shopify store, pull customers/orders/products via API, receive webhook events, and push custom
            signals like cart/checkout to Mongo-backed storage.
          </p>
          <div className="pillbar">
            <span className="pill">REST ingestion</span>
            <span className="pill">Webhook capture</span>
            <span className="pill">Custom events</span>
            <span className="pill">Multi-tenant</span>
          </div>
        </div>
        <div className="hero-card">
          <h3>API base</h3>
          <code>{API_BASE}</code>
          <p className="muted">Set VITE_API_BASE_URL to point at your server (defaults to localhost:4000/api).</p>
          {isAuthed && (
            <p className="muted">
              Signed in as <strong>{userEmail}</strong>
            </p>
          )}
        </div>
      </header>

      <section className="card auth-card">
        <div className="card-header">
          <h3>Email sign-in</h3>
          <span className="badge tone-primary">Protected UI</span>
        </div>
        <form className="form inline" onSubmit={handleLogin}>
          <label>
            Work email
            <input
              required
              type="email"
              value={authInput}
              onChange={(e) => setAuthInput(e.target.value)}
              placeholder="you@company.com"
            />
          </label>
          <div className="actions">
            <button type="submit">{isAuthed ? 'Switch user' : 'Sign in'}</button>
            {isAuthed && (
              <button type="button" className="ghost" onClick={handleLogout}>
                Sign out
              </button>
            )}
          </div>
        </form>
        <p className="muted">
          The UI and onboarding APIs require `x-user-email`; optionally whitelist emails via `ALLOWED_EMAILS` on the
          server.
        </p>
      </section>

      <section className="grid two">
        <div className="card">
          <div className="card-header">
            <h3>Register Shopify store</h3>
            <span className="badge">Multi-tenant</span>
          </div>
          <form className="form" onSubmit={handleRegister}>
            <label>
              Store domain
              <input
                required
                value={registerForm.shopDomain}
                onChange={(e) => setRegisterForm({ ...registerForm, shopDomain: e.target.value })}
                placeholder="example.myshopify.com"
              />
            </label>
            <label>
              Admin API access token
              <input
                required
                value={registerForm.accessToken}
                onChange={(e) => setRegisterForm({ ...registerForm, accessToken: e.target.value })}
                placeholder="shpat_xxx"
              />
            </label>
            <label>
              Friendly name
              <input
                value={registerForm.name}
                onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })}
                placeholder="Northwind Retail"
              />
            </label>
            <label>
              API version (optional)
              <input
                value={registerForm.apiVersion}
                onChange={(e) => setRegisterForm({ ...registerForm, apiVersion: e.target.value })}
                placeholder="2024-10"
              />
            </label>
            <button type="submit" disabled={loading || !isAuthed}>
              {loading ? 'Working...' : 'Save store'}
            </button>
          </form>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Resources to sync</h3>
            <span className="badge tone-primary">API pull</span>
          </div>
          <div className="toggle-row">
            {Object.keys(resourceLabels).map((key) => (
              <label key={key} className={`toggle ${resources.includes(key) ? 'active' : ''}`}>
                <input type="checkbox" checked={resources.includes(key)} onChange={() => toggleResource(key)} />
                {resourceLabels[key]}
              </label>
            ))}
          </div>
          <p className="muted">Choose what to pull when you press Sync on a store below.</p>
          {message && <div className="toast">{message}</div>}
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h3>Connected stores</h3>
          <span className="badge tone-neutral">{shops.length} active</span>
        </div>
        {shops.length === 0 && <p className="muted">No stores yet. Register one to begin ingestion.</p>}
        <div className="shop-grid">
          {shops.map((shop) => (
            <div key={shop._id} className={`shop-card ${shop._id === activeShopId ? 'selected' : ''}`}>
              <div>
                <p className="eyebrow">{shop.shopDomain}</p>
                <h4>{shop.name || 'Unnamed store'}</h4>
                <p className="muted">
                  API {shop.apiVersion || 'default'} - Last sync{' '}
                  {shop.lastSyncedAt ? new Date(shop.lastSyncedAt).toLocaleString() : 'never'}
                </p>
              </div>
              <div className="shop-actions">
                <button onClick={() => triggerSync(shop._id)} disabled={loading}>
                  Sync now
                </button>
                <button className="ghost" onClick={() => handleSelectShop(shop._id)}>
                  View insights
                </button>
                <button
                  className="ghost"
                  onClick={() => window.open(`https://${shop.shopDomain}/admin`, '_blank', 'noopener,noreferrer')}
                >
                  Open admin
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {activeShop && (
        <section className="grid two">
          <div className="card">
            <div className="card-header">
              <h3>Data snapshot</h3>
              <span className="badge tone-primary">{activeShop.name || activeShop.shopDomain}</span>
            </div>
            {!insights && <p className="muted">Fetching insights...</p>}
            {insights && (
              <>
                <div className="stat-grid">
                  <div className="stat">
                    <p className="label">Customers</p>
                    <p className="value">{insights.totals.customers}</p>
                  </div>
                  <div className="stat">
                    <p className="label">Orders</p>
                    <p className="value">{insights.totals.orders}</p>
                    <p className="muted tiny">{trendValue(insights.trend?.orders)}</p>
                  </div>
                  <div className="stat">
                    <p className="label">Products</p>
                    <p className="value">{insights.totals.products}</p>
                  </div>
                  <div className="stat">
                    <p className="label">Revenue</p>
                    <p className="value">${insights.totals.revenue.toFixed(2)}</p>
                    <p className="muted tiny">{trendValue(insights.trend?.revenue)}</p>
                  </div>
                  <div className="stat">
                    <p className="label">Avg order value</p>
                    <p className="value">${(insights.trend?.avgOrderValue?.current || 0).toFixed(2)}</p>
                    <p className="muted tiny">{trendValue(insights.trend?.avgOrderValue)}</p>
                  </div>
                  <div className="stat">
                    <p className="label">Events captured</p>
                    <p className="value">{insights.totals.events}</p>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Custom events</h3>
              <span className="badge">Cart / Checkout</span>
            </div>
            <div className="form inline">
              <label>
                Topic
                <input
                  value={customEvent.topic}
                  onChange={(e) => setCustomEvent({ ...customEvent, topic: e.target.value })}
                  placeholder="checkout_started"
                />
              </label>
              <label>
                Payload JSON
                <textarea
                  rows={3}
                  value={customEvent.payload}
                  onChange={(e) => setCustomEvent({ ...customEvent, payload: e.target.value })}
                />
              </label>
              <div className="actions">
                <button onClick={sendCustomEvent} disabled={loading}>
                  Push event
                </button>
                <button className="ghost" onClick={() => loadEvents(activeShopId)}>
                  Refresh events
                </button>
              </div>
            </div>
            <div className="event-list">
              {events.map((evt) => (
                <div key={evt._id} className="event-item">
                  <div>
                    <p className="eyebrow">{evt.topic}</p>
                    <p className="muted">{new Date(evt.receivedAt || evt.createdAt).toLocaleString()}</p>
                  </div>
                  <pre>{JSON.stringify(evt.payload, null, 2)}</pre>
                </div>
              ))}
              {events.length === 0 && <p className="muted">No events yet.</p>}
            </div>
          </div>
        </section>
      )}

      {activeShop && (
        <section className="grid two">
          <div className="card chart-card">
            <div className="card-header">
              <h3>Orders & revenue by date</h3>
              <span className="badge tone-neutral">Date filter</span>
            </div>
            <div className="form inline">
              <label>
                Start
                <input
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                />
              </label>
              <label>
                End
                <input
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                />
              </label>
              <button
                className="ghost"
                onClick={() => loadOrdersByDate(activeShopId, dateRange.start, dateRange.end)}
                disabled={!dateRange.start || !dateRange.end}
              >
                Apply
              </button>
            </div>
            {ordersByDate.length === 0 && <p className="muted">No orders in this window.</p>}
            {ordersByDate.length > 0 && <Line data={ordersChartData} options={ordersChartOptions} />}
          </div>

          <div className="card chart-card">
            <div className="card-header">
              <h3>Top customers by spend</h3>
              <span className="badge tone-primary">Top 5</span>
            </div>
            {topCustomers.length === 0 && <p className="muted">No customers yet.</p>}
            {topCustomers.length > 0 && <Bar data={topCustomersData} options={{ plugins: { legend: { labels: { color: '#cbd5e1' } } }, scales: { x: { ticks: { color: '#94a3b8' } }, y: { ticks: { color: '#94a3b8' } } } }} />}
          </div>
        </section>
      )}

      {insights && (
        <section className="card">
          <div className="card-header">
            <h3>Recent orders</h3>
            <span className="badge tone-neutral">{insights.recentOrders.length} shown</span>
          </div>
          <div className="table">
            <div className="table-row head">
              <span>Order</span>
              <span>Customer</span>
              <span>Total</span>
              <span>Status</span>
              <span>Date</span>
            </div>
            {insights.recentOrders.map((order) => (
              <div key={order._id} className="table-row">
                <span>{order.name}</span>
                <span>{order.customer?.email || 'N/A'}</span>
                <span>${(order.totalPrice || 0).toFixed(2)}</span>
                <span className="pill tiny">{order.financialStatus || 'n/a'}</span>
                <span>{order.processedAt ? new Date(order.processedAt).toLocaleString() : '-'}</span>
              </div>
            ))}
            {insights.recentOrders.length === 0 && <p className="muted">No orders yet.</p>}
          </div>
        </section>
      )}
    </div>
  );
}

export default App;
