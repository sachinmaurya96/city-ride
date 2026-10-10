type IconName = 'horn' | 'brake' | 'camera' | 'recover' | 'pause' | 'sound' | 'muted' | 'door' | 'accelerate' | 'reverse' | 'wallet' | 'garage' | 'settings' | 'stats' | 'tasks' | 'map';

/** Small, consistent controls that remain legible without large emoji artwork. */
export function ControlIcon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === 'horn' && <><path d="M4 10h4l9-5v14l-9-5H4zM8 14l2 6H6l-2-6M20 8l2-2M20 12h3M20 16l2 2" /></>}
      {name === 'brake' && <><circle cx="12" cy="12" r="7" /><path d="M8 12h8M3.5 5a11 11 0 0 0 0 14M20.5 5a11 11 0 0 1 0 14" /></>}
      {name === 'camera' && <><path d="M3 7h4l2-3h6l2 3h4v13H3z" /><circle cx="12" cy="13" r="4" /></>}
      {name === 'recover' && <><path d="M4 11a8 8 0 1 1 2 7M4 4v7h7" /></>}
      {name === 'pause' && <><path d="M8 5v14M16 5v14" strokeWidth="3" /></>}
      {(name === 'sound' || name === 'muted') && <><path d="M3 9h4l5-4v14l-5-4H3z" />{name === 'sound' ? <path d="M16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14" /> : <path d="m16 9 5 6m0-6-5 6" />}</>}
      {name === 'door' && <><path d="M5 21V4l12-2v19M3 21h18M11 12h2" /></>}
      {name === 'accelerate' && <path d="m6 15 6-6 6 6M6 9l6-6 6 6" />}
      {name === 'reverse' && <path d="m6 9 6 6 6-6M12 15V3M5 21h14" />}
      {name === 'wallet' && <path d="M3 5h16v4H3V5Zm0 4v11h18V9H3Zm13 4h5v4h-5v-4Z" />}
      {name === 'garage' && <path d="m3 8 9-6 9 6v13H3V8Zm4 13V11h10v10M7 15h10M7 18h10" />}
      {name === 'settings' && <><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></>}
      {name === 'stats' && <path d="M4 21V11h4v10M10 21V4h4v17M16 21V8h4v13M2 21h20" />}
      {name === 'tasks' && <path d="M8 4h12v17H4V4h4V2h8v4H8V4Zm0 7 2 2 4-4M8 17h8" />}
      {name === 'map' && <path d="m3 5 6-3 6 3 6-3v17l-6 3-6-3-6 3V5Zm6-3v17M15 5v17" />}
    </svg>
  );
}
