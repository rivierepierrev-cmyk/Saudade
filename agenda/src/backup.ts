import type { Agenda } from './model.ts';

export const BACKUP_FORMAT = 'agenda-enseignant';

/** The whole agenda as a file to keep or to move to another device. */
export function toBackup(agenda: Agenda, now = new Date()): string {
  return JSON.stringify({ format: BACKUP_FORMAT, version: 1, savedAt: now.toISOString(), agenda }, null, 2);
}

const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Reads a backup (or a bare agenda), checking it looks like one. Errors are meant for the user. */
export function fromBackup(text: string): Agenda {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Ce fichier n'est pas une sauvegarde de l'agenda.");
  }
  const wrapped = data as { format?: string; version?: number; agenda?: unknown };
  if (wrapped && typeof wrapped === 'object' && wrapped.format !== undefined && wrapped.format !== BACKUP_FORMAT) {
    throw new Error("Ce fichier n'est pas une sauvegarde de l'agenda.");
  }
  if (wrapped?.format === BACKUP_FORMAT && (wrapped.version ?? 1) > 1) {
    throw new Error('Cette sauvegarde vient d\'une version plus récente de l\'agenda.');
  }
  const a = (wrapped?.format === BACKUP_FORMAT ? wrapped.agenda : data) as Partial<Agenda> | undefined;
  const ok =
    a && typeof a === 'object' &&
    Array.isArray(a.classes) && Array.isArray(a.timetable) && Array.isArray(a.sequences) && Array.isArray(a.placements) &&
    a.calendar && isDate(a.calendar.start) && isDate(a.calendar.end) && Array.isArray(a.calendar.closures);
  if (!ok) throw new Error('Cette sauvegarde est incomplète ou abîmée.');
  return a as Agenda;
}

/** File name for a backup made on `now`: agenda-2025-10-01.json */
export const backupName = (now = new Date()) =>
  `agenda-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.json`;
