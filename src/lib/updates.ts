/** Automatic updates, page side (electron/updater.cjs does the work). */
import { useEffect, useState } from 'react';

export interface UpdateState {
  supported: boolean;
  enabled: boolean;
  current: string;
  status: 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error';
  version: string | null;
  percent: number;
  error: string | null;
}

interface UpdatesBridge {
  get: () => Promise<UpdateState>;
  check: () => Promise<void>;
  install: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  onChange: (listener: (state: UpdateState) => void) => () => void;
}

const bridge: UpdatesBridge | undefined =
  typeof window !== 'undefined' ? (window.saudadeDesktop as unknown as { updates?: UpdatesBridge } | undefined)?.updates : undefined;

/** The update state, kept current; null outside the desktop app. */
export function useUpdates(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    if (!bridge) return;
    bridge.get().then(setState);
    return bridge.onChange(setState);
  }, []);
  return state;
}

export const checkForUpdates = () => bridge?.check();
export const installUpdate = () => bridge?.install();
export const setAutoUpdates = (enabled: boolean) => bridge?.setEnabled(enabled);
