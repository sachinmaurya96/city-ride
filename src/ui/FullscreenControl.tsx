import { useState } from 'react';
import { canFullscreen, isIOS, isStandalone, requestGameFullscreen } from '../app/display';
import { useGame } from '../app/store';
import { ControlIcon } from './ControlIcon';

export function FullscreenControl() {
  const t = useGame(s => s.t);
  const [help, setHelp] = useState(false);
  if (isStandalone()) return null;
  return <div className="fullscreen-control">
    <button className="link" data-testid="fullscreen" onClick={() => {
      void requestGameFullscreen().then(ok => setHelp(!ok));
    }}><ControlIcon name="fullscreen" />{t.fullscreen}</button>
    {(help || (isIOS() && !canFullscreen())) && <p className="fullscreen-help" role="status" data-testid="fullscreen-help">
      {isIOS() ? t.iosFullscreenHelp : t.fullscreenHelp}
    </p>}
  </div>;
}
