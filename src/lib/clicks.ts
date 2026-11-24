import type React from 'react';

let timer: number | undefined;

/**
 * An onClick handler that tells a click from a double click: the click's action
 * waits a moment, and a second click runs the double click's action instead.
 */
export const clickOrDouble = (single: () => void, double: () => void) => (e: React.MouseEvent) => {
  window.clearTimeout(timer);
  if (e.detail >= 2) {
    double();
    return;
  }
  timer = window.setTimeout(single, 250);
};
