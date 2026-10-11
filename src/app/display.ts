type SafariElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type SafariDocument = Document & { webkitFullscreenElement?: Element; webkitFullscreenEnabled?: boolean };

export function isStandalone() {
  return matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches
    || !!(navigator as Navigator & { standalone?: boolean }).standalone;
}

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function canFullscreen() {
  const root = document.documentElement as SafariElement;
  const doc = document as SafariDocument;
  return !!((typeof root.requestFullscreen === 'function' && doc.fullscreenEnabled !== false)
    || (root.webkitRequestFullscreen && doc.webkitFullscreenEnabled !== false));
}

/** Call directly from a tap/click: fullscreen must retain the browser's user activation. */
export async function requestGameFullscreen(): Promise<boolean> {
  const root = document.documentElement as SafariElement;
  const doc = document as SafariDocument;
  let full = isStandalone() || !!(doc.fullscreenElement || doc.webkitFullscreenElement);
  if (!full) {
    try {
      if (typeof root.requestFullscreen === 'function' && doc.fullscreenEnabled !== false) await root.requestFullscreen({ navigationUI: 'hide' });
      else if (root.webkitRequestFullscreen && doc.webkitFullscreenEnabled !== false) await root.webkitRequestFullscreen();
      else return false;
      full = true;
    } catch { return false; }
  }
  // Fullscreen does not depend on orientation-lock support (not available on many iOS devices).
  if (matchMedia('(pointer: coarse)').matches) {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    try { await orientation?.lock?.('landscape'); } catch { /* Manual rotation remains available. */ }
  }
  return full;
}

/** Track the visible viewport when Safari's toolbars, rotation or split-screen resize it. */
export function observeViewport(onResize: (width: number, height: number) => void) {
  const viewport = window.visualViewport;
  const update = () => {
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const style = document.documentElement.style;
    style.setProperty('--viewport-width', `${width}px`);
    style.setProperty('--viewport-height', `${height}px`);
    style.setProperty('--viewport-top', `${viewport?.offsetTop ?? 0}px`);
    style.setProperty('--viewport-left', `${viewport?.offsetLeft ?? 0}px`);
    style.setProperty('--viewport-unit', `${height / 100}px`);
    style.setProperty('--vehicle-button-columns', height <= 340 ? '3' : '2');
    onResize(width, height);
  };
  update();
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  document.addEventListener('fullscreenchange', update);
  document.addEventListener('webkitfullscreenchange', update);
  return () => {
    window.removeEventListener('resize', update);
    window.removeEventListener('orientationchange', update);
    viewport?.removeEventListener('resize', update);
    viewport?.removeEventListener('scroll', update);
    document.removeEventListener('fullscreenchange', update);
    document.removeEventListener('webkitfullscreenchange', update);
  };
}
