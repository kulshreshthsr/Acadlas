// Putting Acadlas on a phone's home screen.
//
// Android browsers offer this through a `beforeinstallprompt` event, which fires once,
// early, before any screen is ready to show a button — so it is caught here at start-up
// and kept until a screen asks for it. iPhones have no such event: there the screen
// explains Safari's Share → Add to Home Screen instead.
import { useSyncExternalStore } from 'react';

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function startInstallSupport() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as InstallPrompt;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });

  // The worker only in a real build: during development it would serve stale files.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Without it the app still works; it just cannot be installed or show the offline page.
      });
    });
  }
}

/** Already running from the home screen. */
export function isInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function useInstallPrompt() {
  const ready = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => deferred !== null,
  );
  return {
    ready,
    async install() {
      if (!deferred) return false;
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      notify();
      return outcome === 'accepted';
    },
  };
}
