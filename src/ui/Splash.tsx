import { useEffect, useState } from 'react';
import { useGame } from '../app/store';
import landscapeCover from '../../playgama/assets/covers/city-ride-landscape-1920x1080.png';
import portraitCover from '../../playgama/assets/covers/city-ride-portrait-1080x1920.png';
import squareCover from '../../playgama/assets/covers/city-ride-square-800x800.png';
import { useAssetProgress } from '../game/render/assetLoading';

/** Opening cover duration only; vehicle loading has no minimum wait. */
export const SPLASH_MS = 3000;
const SEGMENTS = 28;

/** Responsive Playgama cover artwork with the existing loading progress bar. */
export function Splash({ stage, error, onRetry, loadingWorld, vehicleName, assetUrl }: { stage: number; error: string | null; onRetry: () => void; loadingWorld: boolean; vehicleName?: string; assetUrl?: string }) {
  const t = useGame((s) => s.t);
  const [elapsed, setElapsed] = useState(0);
  const downloaded = useAssetProgress(loadingWorld ? assetUrl : undefined);
  useEffect(() => {
    const start = performance.now();
    // The bar needs ten updates/sec, leaving the main thread available for model decoding.
    const timer = setInterval(() => setElapsed(performance.now() - start), 100);
    return () => clearInterval(timer);
  }, [loadingWorld]);
  const total = t.loadingStages.length - 1;
  // Asset download/decoding advances the same bar; only scene readiness can dismiss it.
  const progress = loadingWorld
    ? downloaded * .97
    : Math.min(elapsed / SPLASH_MS, 1) * (stage >= total ? 1 : .96);
  const pct = Math.round(progress * 100);
  const lit = Math.floor(progress * SEGMENTS);
  const label = loadingWorld ? `${t.carLoading} ${vehicleName ?? ''}` : t.loadingStages[Math.min(stage, total)];
  return (
    <div className="splash" data-testid="boot" aria-busy={!error}>
      <picture className="splash-cover" aria-hidden>
        <source media="(max-aspect-ratio: 3/4)" srcSet={portraitCover} />
        <source media="(min-aspect-ratio: 4/3)" srcSet={landscapeCover} />
        <img src={squareCover} alt="" draggable={false} fetchPriority="high" />
      </picture>
      <div className="splash-shade" aria-hidden />
      {error ? (
        <div className="boot-error">
          <p>{error}</p>
          <button className="btn primary" onClick={onRetry}>{t.retry}</button>
        </div>
      ) : (
        <div className="splash-bottom">
          <div className="robo-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="robo-head">
              <span className="robo-status">{t.loading}<i className="robo-caret" /></span>
              <span className="robo-stage">{label}</span>
              <b className="robo-pct" data-testid="boot-progress">{pct}%</b>
            </div>
            <div className="robo-track">
              {Array.from({ length: SEGMENTS }, (_, i) => (
                <i key={i} className={i < lit ? 'lit' : i === lit ? 'head' : ''} />
              ))}
            </div>
            <div className="robo-foot"><span>{t.loadTip}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
