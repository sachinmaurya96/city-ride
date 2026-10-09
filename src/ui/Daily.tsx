import { useEffect, useState } from 'react';
import { useGame } from '../app/store';
import { events } from '../game/core/events';
import { averageRating, claimDaily, levelForXP, nextResetMs } from '../game/progression/progression';
import { fmt, meters, money } from '../i18n/strings';
import { Modal } from './Screens';

function useCountdown(target: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((target - now) / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

const ICONS: Record<string, string> = { jobs3: '🚕', clean2: '🛡️', earn1000: '🪙', dest2: '🧭', family1: '👨‍👩‍👧', airport1: '✈️', bus1: '🚌' };

export function DailyOverlay() {
  const t = useGame((s) => s.t);
  const save = useGame((s) => s.save);
  const commit = useGame((s) => s.commit);
  const close = useGame((s) => s.closeOverlay);
  const reset = nextResetMs(Date.now());
  const countdown = useCountdown(reset);
  const resetLocal = new Date(reset).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const claim = (id: string) => {
    const cur = useGame.getState().save;
    const r = claimDaily(cur, id, Date.now());
    if (!r.error) {
      commit(r.save, true);
      events.emit({ type: 'DAILY_CLAIMED', id });
    }
  };
  return (
    <Modal label={t.todaysChallenges} onClose={close} className="daily" testId="daily">
      <div className="modal-head">
        <h2>{t.todaysChallenges}</h2>
        <div className="reset">
          ⏰ {t.resetsIn} <b>{countdown}</b>
          <small>{fmt(t.nextReset, { time: resetLocal })}</small>
        </div>
        <button className="icon-btn" onClick={close} aria-label={t.close}>
          ✕
        </button>
      </div>
      <div className="task-cards">
        {save.daily.tasks.map((task) => {
          const [name, desc] = t.tasks[task.template] ?? [task.template, ''];
          const ready = task.progress >= task.target && !task.claimed;
          const isMoney = task.template === 'earn1000';
          return (
            <div key={task.id} className={`task ${task.claimed ? 'done' : ''}`} data-testid={`task-${task.template}`}>
              <div className="task-ico">{ICONS[task.template] ?? '⭐'}</div>
              <h3>{name}</h3>
              <p>{desc}</p>
              <div className="bar">
                <i style={{ width: `${(task.progress / task.target) * 100}%` }} />
              </div>
              <div className="prog">{isMoney ? `${money(task.progress)} / ${money(task.target)}` : `${task.progress} / ${task.target}`}</div>
              <div className="reward">
                🪙 {money(task.rewardCash)} + <span className="xp">{task.rewardXP} XP</span>
              </div>
              <button className={`btn ${ready ? 'primary' : 'disabled'}`} disabled={!ready} onClick={() => claim(task.id)} data-testid={`claim-${task.template}`}>
                {task.claimed ? t.claimed : ready ? t.claimReward : t.inProgress}
              </button>
            </div>
          );
        })}
      </div>
      <div className="lifetime-strip">
        <b>{t.lifetime.toUpperCase()}</b>
        <span>🚗 {save.lifetime.jobs} {t.successfulRides}</span>
        <span>👥 {save.lifetime.passengers} {t.passengers}</span>
        <span>⭐ {t.level} {levelForXP(save.totalXP)}</span>
      </div>
      <button className="btn primary" onClick={close}>
        {t.continueDriving} ›
      </button>
    </Modal>
  );
}

export function StatsOverlay() {
  const t = useGame((s) => s.t);
  const save = useGame((s) => s.save);
  const close = useGame((s) => s.closeOverlay);
  const [tab, setTab] = useState<'today' | 'lifetime'>('today');
  const d = save.daily;
  const l = save.lifetime;
  const rows: [string, string][] =
    tab === 'today'
      ? [
          [t.jobs, String(d.jobs)],
          [t.cleanRides, String(d.cleanJobs)],
          [t.busRoutes, String(d.busRoutes)],
          [t.earnings, money(d.earned)],
        ]
      : [
          [t.jobs, String(l.jobs)],
          [t.busRoutes, String(l.busRoutes)],
          [t.passengersDelivered, String(l.passengers)],
          [t.earnings, money(l.fareCredits)],
          [t.fines, money(l.finesPaid)],
          [t.distance, meters(l.distanceM)],
          [t.cleanRides, String(l.cleanRides)],
          [t.rating, save.recentRatings.length ? `${averageRating(save).toFixed(1)} ★` : '—'],
          [t.highestLevel, String(l.highestLevel)],
          [t.vehiclesOwned, String(save.ownedVehicleIds.length)],
        ];
  return (
    <Modal label={t.statistics} onClose={close} className="stats" testId="stats">
      <div className="modal-head">
        <h2>📊 {t.statistics}</h2>
        <button className="icon-btn" onClick={close} aria-label={t.close}>
          ✕
        </button>
      </div>
      <div className="seg">
        <button className={tab === 'today' ? 'on' : ''} onClick={() => setTab('today')}>
          {t.today}
        </button>
        <button className={tab === 'lifetime' ? 'on' : ''} onClick={() => setTab('lifetime')} data-testid="stats-lifetime">
          {t.lifetime}
        </button>
      </div>
      <div className="stat-grid">
        {rows.map(([k, v]) => (
          <div key={k} className="stat">
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>
      <button className="btn primary" onClick={close}>
        {t.close}
      </button>
    </Modal>
  );
}
