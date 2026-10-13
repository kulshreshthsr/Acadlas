// The toast channel: one line confirming what just happened. The provider that draws
// them lives in components/ui.tsx; screens call useToast() to send one.
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

export const ToastContext = createContext<(message: ReactNode, tone?: 'good' | 'bad') => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}
