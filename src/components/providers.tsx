'use client';

import { ThemeProvider } from 'next-themes';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

const HIDE_KEY = 'lf:hide-values';
const HideCtx = createContext<{ hidden: boolean; toggle: () => void }>({
  hidden: false,
  toggle: () => {},
});

export function useHideValues() {
  return useContext(HideCtx);
}

const hideListeners = new Set<() => void>();

function readHidden() {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false; // armazenamento indisponível: segue visível
  }
}

function subscribeHidden(cb: () => void) {
  hideListeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    hideListeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
}

function HideValuesProvider({ children }: { children: ReactNode }) {
  const hidden = useSyncExternalStore(subscribeHidden, readHidden, () => false);
  useEffect(() => {
    document.documentElement.dataset.hideValues = String(hidden);
  }, [hidden]);
  const toggle = useCallback(() => {
    try {
      localStorage.setItem(HIDE_KEY, readHidden() ? '0' : '1');
    } catch {
      /* ignora */
    }
    hideListeners.forEach((l) => l());
  }, []);
  return <HideCtx.Provider value={{ hidden, toggle }}>{children}</HideCtx.Provider>;
}

function ServiceWorkerRegistration() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true';
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    }
  }, []);
  return null;
}

export function Providers({ children, nonce }: { children: ReactNode; nonce?: string }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      nonce={nonce}
    >
      <HideValuesProvider>
        <ServiceWorkerRegistration />
        {children}
      </HideValuesProvider>
    </ThemeProvider>
  );
}
