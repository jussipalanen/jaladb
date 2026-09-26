import { useEffect, useState } from 'react';
import { callApi } from '../api.ts';

type Health = 'checking' | 'ok' | 'down';

const styles: Record<Health, { dot: string; text: string; label: string }> = {
  checking: { dot: 'bg-slate-400', text: 'text-slate-300', label: 'Checking API…' },
  ok: { dot: 'bg-emerald-400 shadow-[0_0_10px] shadow-emerald-400/70', text: 'text-emerald-300', label: 'API & database online' },
  down: { dot: 'bg-rose-500', text: 'text-rose-300', label: 'API unreachable' },
};

/** Polls GET /api/health, which also checks the database connection. */
export function HealthBadge() {
  const [health, setHealth] = useState<Health>('checking');

  useEffect(() => {
    let active = true;
    const check = async () => {
      const response = await callApi('GET', '/api/health');
      if (active) setHealth(response.ok ? 'ok' : 'down');
    };
    void check();
    const timer = setInterval(check, 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const style = styles[health];
  return (
    <div
      className="flex items-center gap-2 rounded-full bg-slate-900/80 px-3 py-1.5 text-xs font-medium ring-1 ring-blue-900/60"
      role="status"
    >
      <span className={`size-2 rounded-full ${style.dot}`} aria-hidden="true" />
      <span className={style.text}>{style.label}</span>
    </div>
  );
}
