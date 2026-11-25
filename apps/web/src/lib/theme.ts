import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * Light, dark, or whatever the OS says. Stored per browser, not per user: the
 * same person on a bright office monitor and a phone at night wants both.
 *
 * public/theme-init.js applies the stored choice before React loads, so a
 * dark-mode user never sees a white flash. The two must agree on the key.
 */
export type ThemePreference = 'light' | 'dark' | 'system';

const KEY = 'pp.theme';
const listeners = new Set<() => void>();
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function read(): ThemePreference {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function apply(pref: ThemePreference) {
  const dark = pref === 'dark' || (pref === 'system' && media().matches);
  document.documentElement.classList.toggle('dark', dark);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme() {
  const preference = useSyncExternalStore(subscribe, read, () => 'system' as const);

  // Follow the OS while the preference is "system".
  useEffect(() => {
    if (preference !== 'system') return;
    const mq = media();
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* storage blocked: still switch for this page */
    }
    apply(next);
    listeners.forEach((l) => l());
  }, []);

  const resolved: 'light' | 'dark' =
    preference === 'system' ? (media().matches ? 'dark' : 'light') : preference;

  return { preference, resolved, setPreference };
}
