import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

const PLANS = [
  { id: 'free', name: 'Free', minutes: 15, IN: '₹0', INTL: '$0' },
  { id: 'basic', name: 'Basic', minutes: 100, IN: '₹299 / month', INTL: '$9 / month' },
  { id: 'pro', name: 'Pro', minutes: 300, IN: '₹799 / month', INTL: '$19 / month', extra: 'Speak in your own voice' },
];

export default function Plan() {
  const { user, usage, refresh } = useAuth();
  const [error, setError] = useState('');
  const [canSwitch, setCanSwitch] = useState(true);

  useEffect(() => {
    api('/health')
      .then((h) => setCanSwitch(h.free_plan_switching !== false))
      .catch(() => {});
  }, []);

  async function choose(plan) {
    setError('');
    try {
      await api('/api/me/plan', { method: 'POST', body: { plan } });
      await refresh();
    } catch (err) {
      setError(err.status === 403 ? 'Online payments are coming soon (UPI and cards via Razorpay).' : err.message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1>Plan and billing</h1>
          <p className="muted">You have {Math.floor(usage?.minutes_left ?? 0)} of {usage?.minutes_quota} minutes left this month. Minutes reset on the 1st.</p>
        </div>
      </div>
      {error && <p className="alert info">{error}</p>}
      <div className="cards">
        {PLANS.map((p) => {
          const current = user.plan === p.id;
          return (
            <div key={p.id} className="product" style={{ border: current ? '2px solid var(--blue)' : undefined }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3 style={{ fontSize: 20 }}>{p.name}</h3>
                {current && <span className="pill blue">Your plan</span>}
              </div>
              <span className="price" style={{ fontSize: 34 }}>{p[user.region] || p.IN}</span>
              <p className="muted">{p.minutes} minutes every month{p.extra ? ` · ${p.extra}` : ''}</p>
              <button type="button" className={`btn cta ${current || !canSwitch ? 'outline' : 'primary'}`} disabled={current || !canSwitch} onClick={() => choose(p.id)}>
                {current ? 'Current plan' : canSwitch ? `Switch to ${p.name}` : 'Coming soon'}
              </button>
            </div>
          );
        })}
      </div>
      <p className="tiny">
        {canSwitch
          ? 'While DEV_MODE is on, switching plans is free so you can test. Real checkout (Razorpay for India, Stripe abroad) is on the roadmap.'
          : 'Paid plans open soon, with UPI and cards through Razorpay. Need more minutes during the pilot? Contact the BolBridge team.'}
      </p>
    </>
  );
}
