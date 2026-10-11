import { useEffect, useState } from 'react';
import { useGame } from '../app/store';
import bmw from '../assets/splash/bmw_m4_gt3.webp';
import huracan from '../assets/splash/black_huracan.webp';
import porsche from '../assets/splash/porsche_718.webp';
import mclaren from '../assets/splash/mclaren_p1.webp';
import { useAssetProgress } from '../game/render/assetLoading';

/** Opening showcase duration only; vehicle loading has no minimum wait. */
export const SPLASH_MS = 3000;
export const SPLASH_CARS = [
  { src: bmw, name: 'BMW M4 GT3 EVO', short: 'M4 GT3' },
  { src: huracan, name: 'Lamborghini Huracán', short: 'Huracán' },
  { src: porsche, name: 'Porsche 718 Spyder', short: '718 Spyder' },
  { src: mclaren, name: 'McLaren P1 GTR', short: 'P1 GTR' },
];
const SEGMENTS = 28;
const STATUS = ['BOOT.SEQUENCE', 'LINK.SAVE_DATA', 'SYNC.PROFILE', 'LOAD.CITY_GRID', 'IGNITION.READY'];

/** Cover splash: supercar slideshow + thumbnail rail + segmented "system" progress bar. */
export function Splash({ stage, error, onRetry, loadingWorld, vehicleName, assetUrl }: { stage: number; error: string | null; onRetry: () => void; loadingWorld: boolean; vehicleName?: string; assetUrl?: string }) {
  const t = useGame((s) => s.t);
  const [elapsed, setElapsed] = useState(0);
  const downloaded = useAssetProgress(loadingWorld ? assetUrl : undefined);
  useEffect(() => {
    const start = performance.now();
    // Slideshow and bar need ten updates/sec, leaving the main thread available for model decoding.
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
  const slide = Math.floor(elapsed / (SPLASH_MS / SPLASH_CARS.length)) % SPLASH_CARS.length;
  const status = loadingWorld ? 'LOAD.VEHICLE' : STATUS[Math.min(STATUS.length - 1, Math.floor(progress * STATUS.length))];
  const label = loadingWorld ? `${t.carLoading} ${vehicleName ?? ''}` : t.loadingStages[Math.min(stage, total)];
  return (
    <div className="splash" data-testid="boot" aria-busy={!error}>
      <div className="splash-slides" aria-hidden>
        {SPLASH_CARS.map((car, i) => (
          <img key={car.name} src={car.src} alt="" className={i === slide ? 'on' : ''} draggable={false} />
        ))}
      </div>
      <div className="splash-shade" aria-hidden />
      <div className="splash-scan" aria-hidden />
      <div className="splash-top">
        <div className="wordmark">
          <span className="w1">CITY</span> <span className="w2">RIDE</span>
          <div className="w3">{t.subtitle}</div>
        </div>
        <div className="splash-car-name" aria-live="polite">// {loadingWorld ? vehicleName : SPLASH_CARS[slide].name}</div>
      </div>
      {error ? (
        <div className="boot-error">
          <p>{error}</p>
          <button className="btn primary" onClick={onRetry}>{t.retry}</button>
        </div>
      ) : (
        <div className="splash-bottom">
          <div className="splash-thumbs" aria-hidden>
            {SPLASH_CARS.map((car, i) => (
              <div key={car.name} className={`splash-thumb${i === slide ? ' on' : ''}`}>
                <img src={car.src} alt="" draggable={false} />
                <span>{car.short}</span>
              </div>
            ))}
          </div>
          <div className="robo-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="robo-head">
              <span className="robo-status">▸ {status}<i className="robo-caret" /></span>
              <span className="robo-stage">{label}</span>
              <b className="robo-pct" data-testid="boot-progress">{String(pct).padStart(3, '0')}%</b>
            </div>
            <div className="robo-track">
              {Array.from({ length: SEGMENTS }, (_, i) => (
                <i key={i} className={i < lit ? 'lit' : i === lit ? 'head' : ''} />
              ))}
            </div>
            <div className="robo-foot"><span>SYS.V1 · CORE {String(lit).padStart(2, '0')}/{SEGMENTS}</span><span>{t.loadTip}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
