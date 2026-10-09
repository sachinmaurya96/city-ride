import { useGame } from '../app/store';
import { pauseManager } from '../game/core/pause';
import { grantRewardedBonus } from '../game/progression/progression';
import { fmt, money } from '../i18n/strings';
import { platform } from './index';

let rewardedInFlight = false;

/**
 * Optional rewarded bonus (+50% of base fare) for an already-settled receipt. Gameplay and audio
 * freeze through the shared pause manager; the bonus is granted only on a confirmed reward and only once.
 */
export async function requestRewardedBonus(receiptId: string) {
  if (rewardedInFlight) return;
  rewardedInFlight = true;
  const st = useGame.getState();
  pauseManager.add('AD');
  try {
    const res = await platform().showRewarded();
    if (res === 'rewarded') {
      const cur = useGame.getState();
      const g = grantRewardedBonus(cur.save, receiptId, Date.now());
      if (g.amount > 0) {
        cur.commit(g.save, true);
        cur.toast(fmt(cur.t.bonusAdded, { amount: money(g.amount) }), 'good');
      }
    } else if (res === 'unavailable' || res === 'error') {
      st.toast(st.t.adUnavailable, 'info');
    }
  } catch {
    st.toast(st.t.adUnavailable, 'info');
  } finally {
    pauseManager.remove('AD');
    rewardedInFlight = false;
  }
}

/** Interstitial only at natural breaks: after ≥3 jobs since the last one and ≥180 s apart. */
export async function maybeInterstitial() {
  const st = useGame.getState();
  const s = st.save;
  if (s.lifetime.jobs < 3) return;
  if (s.adState.jobsSinceInterstitial < 3) return;
  if (Date.now() - s.adState.lastInterstitialAt < 180_000) return;
  pauseManager.add('AD');
  try {
    await platform().showInterstitial();
  } catch {
    /* ignore */
  } finally {
    const cur = useGame.getState();
    const next = structuredClone(cur.save);
    next.adState = { jobsSinceInterstitial: 0, lastInterstitialAt: Date.now() };
    next.revision++;
    cur.commit(next, false);
    pauseManager.remove('AD');
  }
}
