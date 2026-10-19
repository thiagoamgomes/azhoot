import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';
const KEY = 'azhoot:theme';

function apply(theme: Theme) {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function initTheme() {
  apply((localStorage.getItem(KEY) as Theme) ?? 'system');
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(KEY) as Theme) ?? 'system');
  useEffect(() => {
    localStorage.setItem(KEY, theme);
    apply(theme);
  }, [theme]);
  return [theme, setTheme] as const;
}

/** Força tema escuro (telas de apresentação e participante) enquanto montado. */
export function useForcedDark() {
  useEffect(() => {
    const had = document.documentElement.classList.contains('dark');
    document.documentElement.classList.add('dark');
    return () => {
      if (!had) document.documentElement.classList.remove('dark');
    };
  }, []);
}

const MOTION_KEY = 'azhoot:reduce-motion';
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (localStorage.getItem(MOTION_KEY) === '1') return true;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  });
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduced);
    localStorage.setItem(MOTION_KEY, reduced ? '1' : '0');
  }, [reduced]);
  return [reduced, setReduced] as const;
}
