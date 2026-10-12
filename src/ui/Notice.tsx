import { useGame } from '../app/store';
import { fmt, money } from '../i18n/strings';
import { Modal } from './Screens';
import { ControlIcon } from './ControlIcon';

/** Traffic notice / police capture card (plan §14.2). Warnings auto-dismiss; fines need Continue. */
export function NoticeCard() {
  const t = useGame((s) => s.t);
  const n = useGame((s) => s.notice);
  const setNotice = useGame((s) => s.setNotice);
  if (!n) return null;
  if (n.warning) {
    return (
      <div className="warn-banner" role="status" data-testid="warning">
        <ControlIcon name="alert" /> <b>{t.warning}:</b> {t.violations[n.offense] ?? n.offense} — {t.violationTips[n.offense] ?? ''}
      </div>
    );
  }
  const close = () => setNotice(null);
  return (
    <Modal label={t.trafficNotice} onClose={close} className="notice" testId="notice">
      <div className="badge"><ControlIcon name="shield" /></div>
      <h2>{n.capture ? t.captured : t.trafficNotice}</h2>
      <div className="muted">{t.reason}</div>
      <div className="reason">{t.violations[n.offense] ?? t.pursuit}</div>
      <div className="fine-box">
        {(!n.capture || n.fine > 0) && (
          <div>
            {t.fine}: <b>{money(n.fine)}</b>
          </div>
        )}
        {n.capture && n.impound > 0 && (
          <div>
            {t.impound}: <b>{money(n.impound)}</b>
          </div>
        )}
      </div>
      <p className="muted">{n.capture ? t.captureBody : t.violationTips[n.offense] ?? ''}</p>
      {!n.capture && (
        <div className="heat-row">
          {t.policeAttention}
          <div className="bar">
            <i style={{ width: `${Math.round(n.heat)}%` }} />
          </div>
        </div>
      )}
      <button className="btn primary" onClick={close} data-testid="notice-continue">
        {t.continueDriving} →
      </button>
      {!n.capture && <small className="muted center">{fmt(t.rideCanContinue, {})}</small>}
    </Modal>
  );
}
