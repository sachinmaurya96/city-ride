/** Small shortcut badge pinned to a button's top-right corner; CSS shows it in desktop (keyboard) mode only. */
export function KeyHint({ k }: { k: string }) {
  return <kbd className="key-hint" aria-hidden>{k}</kbd>;
}
