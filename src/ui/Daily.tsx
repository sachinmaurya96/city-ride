import { useEffect, useState, type ComponentProps } from 'react';
import { useGame } from '../app/store';
import { events } from '../game/core/events';
import { averageRating, claimDaily, levelForXP, nextResetMs } from '../game/progression/progression';
import { fmt, meters, money } from '../i18n/strings';
import { Modal } from './Screens';
import { ControlIcon } from './ControlIcon';
import './panelsTheme.css';

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

const ICONS: Record<string, ComponentProps<typeof ControlIcon>['name']> = { jobs3: 'garage', clean2: 'shield', earn1000: 'wallet', dest2: 'map', family1: 'passengers', airport1: 'map', bus1: 'bus' };

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
        <h2><ControlIcon name="tasks" /> {t.todaysChallenges}</h2>
        <button className="icon-btn" onClick={close} aria-label={t.close}>
          ✕
        </button>
      </div>
      <div className="reset daily-reset">
        <span><ControlIcon name="recover" /> {t.resetsIn} <b>{countdown}</b></span>
        <small>{fmt(t.nextReset, { time: resetLocal })}</small>
      </div>
      <div className="task-cards">
        {save.daily.tasks.map((task, index) => {
          const [name, desc] = t.tasks[task.template] ?? [task.template, ''];
          const ready = task.progress >= task.target && !task.claimed;
          const isMoney = task.template === 'earn1000';
          const progress = isMoney ? `${money(task.progress)} / ${money(task.target)}` : `${task.progress} / ${task.target}`;
          return (
            <div key={task.id} className={`task ${task.claimed ? 'done' : ready ? 'ready' : ''}`} data-testid={`task-${task.template}`}>
              <div className="task-heading">
                <div className="task-ico"><ControlIcon name={ICONS[task.template] ?? 'tasks'} /></div>
                <span className="task-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              </div>
              <h3>{name}</h3>
              <p>{desc}</p>
              <div className="task-progress">
                <div className="prog">{progress}</div>
                <div className="bar" role="progressbar" aria-label={name} aria-valuemin={0} aria-valuemax={task.target} aria-valuenow={Math.min(task.target, task.progress)} aria-valuetext={progress}>
                  <i style={{ width: `${Math.min(100, (task.progress / task.target) * 100)}%` }} />
                </div>
              </div>
              <div className="reward">
                <ControlIcon name="wallet" /> {money(task.rewardCash)} <span className="xp">+ {task.rewardXP} XP</span>
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
        <span><ControlIcon name="garage" /> {save.lifetime.jobs} {t.successfulRides}</span>
        <span><ControlIcon name="passengers" /> {save.lifetime.passengers} {t.passengers}</span>
        <span><ControlIcon name="stats" /> {t.level} {levelForXP(save.totalXP)}</span>
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
        <h2><ControlIcon name="stats" /> {t.statistics}</h2>
        <button className="icon-btn" onClick={close} aria-label={t.close}>
          ✕
        </button>
      </div>
      <div className="seg" role="group" aria-label={t.statistics}>
        <button className={tab === 'today' ? 'on' : ''} aria-pressed={tab === 'today'} onClick={() => setTab('today')}>
          {t.today}
        </button>
        <button className={tab === 'lifetime' ? 'on' : ''} aria-pressed={tab === 'lifetime'} onClick={() => setTab('lifetime')} data-testid="stats-lifetime">
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
