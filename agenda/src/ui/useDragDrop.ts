import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ISODate } from '../dates.ts';

export type DragPayload = { kind: 'sequence'; sequenceId: string } | { kind: 'move'; placementId: string };

/** Where something can be dropped: a lesson (starts there) or a class or group (follows its séquences). */
export type DropTarget = { kind: 'lesson'; classId: string; groupId?: string; date: ISODate } | { kind: 'class'; classId: string; groupId?: string };

export interface DragState {
  payload: DragPayload;
  x: number;
  y: number;
  target?: DropTarget;
}

/** Props that make an element a drop target. */
export const dropLesson = (classId: string, date: ISODate, groupId?: string) => ({ 'data-drop': 'lesson', 'data-class': classId, 'data-date': date, ...(groupId ? { 'data-group': groupId } : {}) });
export const dropClass = (classId: string, groupId?: string) => ({ 'data-drop': 'class', 'data-class': classId, ...(groupId ? { 'data-group': groupId } : {}) });

function targetAt(x: number, y: number): DropTarget | undefined {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]');
  if (!el) return undefined;
  const classId = el.dataset.class!;
  const groupId = el.dataset.group || undefined;
  return el.dataset.drop === 'lesson' ? { kind: 'lesson', classId, groupId, date: el.dataset.date! } : { kind: 'class', classId, groupId };
}

const THRESHOLD = 5;

/**
 * Drag with the pointer (mouse, pen or finger) from an element to a drop target. A press that does not
 * move is left to the element's click; the click right after a drag is swallowed.
 */
export function useDragDrop(onDrop: (payload: DragPayload, target: DropTarget) => void) {
  const [drag, setDrag] = useState<DragState | undefined>();
  const pending = useRef<{ payload: DragPayload; x: number; y: number; pointerId: number } | undefined>(undefined);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;
  const swallowClick = useRef(false);

  const current = useRef<DragState | undefined>(undefined);
  const update = (d: DragState | undefined) => {
    current.current = d;
    setDrag(d);
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if (!current.current && Math.hypot(e.clientX - p.x, e.clientY - p.y) < THRESHOLD) return;
      e.preventDefault();
      update({ payload: p.payload, x: e.clientX, y: e.clientY, target: targetAt(e.clientX, e.clientY) });
    };
    const up = (e: PointerEvent) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      pending.current = undefined;
      const d = current.current;
      update(undefined);
      if (!d) return;
      swallowClick.current = true;
      setTimeout(() => (swallowClick.current = false), 0);
      const target = targetAt(e.clientX, e.clientY);
      if (target) dropRef.current(d.payload, target);
    };
    const cancel = () => {
      pending.current = undefined;
      update(undefined);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && cancel();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
    };
  }, []);

  /** Call from onPointerDown of the element being dragged. */
  const begin = (payload: DragPayload, e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if (e.pointerType !== 'mouse') e.currentTarget.releasePointerCapture?.(e.pointerId);
    pending.current = { payload, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
  };

  /** Wrap onClick handlers of draggable elements: no click right after a drag. */
  const click = (handler: () => void) => () => {
    if (!swallowClick.current) handler();
  };

  return { drag, begin, click };
}
