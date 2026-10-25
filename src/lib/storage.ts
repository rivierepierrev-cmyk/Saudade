import { DocumentItem, ExtractItem, ClozeItem, ReviewLog, GemmaStats, FolioleStats } from '../types/foliole';
import { SAMPLE_DOCUMENTS, SAMPLE_EXTRACTS, SAMPLE_CLOZES } from './sampleData';
import { CollectionName, getRaw, setRaw, reportStorageError } from './kv';

export interface AppSettings {
  readingFont: 'sans' | 'serif' | 'mono';
  readingFontSize: number; // 14 to 22
  readingLineHeight: number; // 1.4 to 2.0
  readingColumnWidth: 'narrow' | 'normal' | 'wide';
  targetRetention: number; // default 0.90
  dailyReviewLimit: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  readingFont: 'serif',
  readingFontSize: 18,
  readingLineHeight: 1.7,
  readingColumnWidth: 'normal',
  targetRetention: 0.90,
  dailyReviewLimit: 50,
};

export type RestoreResult = { ok: true; counts: { documents: number; extracts: number; clozes: number } } | { ok: false; error: string };

const DEFAULT_FOLDERS = [
  'Apprentissage & Mémoire',
  'Apprentissage & Mémoire/SuperMemo',
  'Apprentissage & Mémoire/Répétition Espacée',
  'Sciences',
  'Sciences/Neurobiologie',
  'Philosophie',
  'Philosophie/Stoïcisme',
  'Général',
];

// Parsed values, so repeated reads (e.g. stats on every render) don't re-parse JSON.
const parsedCache = new Map<CollectionName, unknown>();
// Collections whose stored value couldn't be parsed. Saving over them is refused so
// the original data is never lost; the user is told to restore a backup.
const unreadable = new Set<CollectionName>();

function load<T>(name: CollectionName, validate: (v: unknown) => boolean, seed: () => T, empty: T): T {
  if (parsedCache.has(name)) return parsedCache.get(name) as T;
  const raw = getRaw(name);
  if (raw === null) {
    const seeded = seed();
    save(name, seeded);
    return seeded;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!validate(parsed)) throw new Error('format inattendu');
    parsedCache.set(name, parsed);
    return parsed as T;
  } catch (e) {
    if (!unreadable.has(name)) {
      unreadable.add(name);
      reportStorageError(
        `Les données « ${name} » sont illisibles (${e instanceof Error ? e.message : e}). ` +
          'Elles ne seront pas écrasées : restaurez une sauvegarde.'
      );
    }
    return empty;
  }
}

function save(name: CollectionName, value: unknown): void {
  if (unreadable.has(name)) {
    reportStorageError(`Enregistrement de « ${name} » bloqué : les données existantes sont illisibles.`);
    return;
  }
  parsedCache.set(name, value);
  setRaw(name, JSON.stringify(value));
}

const isArray = (v: unknown) => Array.isArray(v);
const isObject = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);

export class GemmaStorage {
  static getDocuments(): DocumentItem[] {
    const docs = load<DocumentItem[]>('documents', isArray, () => SAMPLE_DOCUMENTS, []);
    const sampleMap = new Map(SAMPLE_DOCUMENTS.map((d) => [d.id, d.folder]));
    return docs.map((doc) => ({
      ...doc,
      folder: doc.folder || sampleMap.get(doc.id) || 'Général',
    }));
  }

  static saveDocuments(docs: DocumentItem[]): void {
    save('documents', docs);
  }

  static getExtracts(): ExtractItem[] {
    const exts = load<ExtractItem[]>('extracts', isArray, () => SAMPLE_EXTRACTS, []);
    return exts.map((ext) => ({ ...ext, folder: ext.folder || 'Général' }));
  }

  static saveExtracts(extracts: ExtractItem[]): void {
    save('extracts', extracts);
  }

  static getClozes(): ClozeItem[] {
    const clzs = load<ClozeItem[]>('clozes', isArray, () => SAMPLE_CLOZES, []);
    return clzs.map((clz) => ({ ...clz, folder: clz.folder || 'Général' }));
  }

  static saveClozes(clozes: ClozeItem[]): void {
    save('clozes', clozes);
  }

  static getFolders(): string[] {
    const folders = load<string[]>('folders', isArray, () => DEFAULT_FOLDERS, []);
    return folders.length > 0 ? folders : ['Général'];
  }

  static saveFolders(folders: string[]): void {
    save('folders', Array.from(new Set(folders.filter(Boolean))));
  }

  static getReviewLogs(): ReviewLog[] {
    return load<ReviewLog[]>('reviewLogs', isArray, () => [], []);
  }

  static appendReviewLog(log: ReviewLog): void {
    save('reviewLogs', [...this.getReviewLogs(), log]);
  }

  static getSettings(): AppSettings {
    return { ...DEFAULT_SETTINGS, ...load<Partial<AppSettings>>('settings', isObject, () => ({}), {}) };
  }

  static saveSettings(settings: AppSettings): void {
    save('settings', settings);
  }

  static computeStats(
    docs: DocumentItem[],
    extracts: ExtractItem[],
    clozes: ClozeItem[],
    logs: ReviewLog[]
  ): GemmaStats {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const isDue = (dateStr: string) => new Date(dateStr) <= today;

    const dueDocs = docs.filter(d => d.state !== 'dismissed' && isDue(d.fsrs.nextReviewDate)).length;
    const dueExtracts = extracts.filter(e => e.state !== 'dismissed' && isDue(e.fsrs.nextReviewDate)).length;
    const dueClozes = clozes.filter(c => c.state !== 'dismissed' && isDue(c.fsrs.nextReviewDate)).length;

    // Today's reviews
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todayReviews = logs.filter(
      l => new Date(l.reviewDate) >= startOfToday
    );

    // Real retention: share of successful recalls (Hard/Good/Easy) among card
    // reviews of the last 30 days. Null until there is something to measure.
    const since = Date.now() - 30 * 86400000;
    const recentCardLogs = logs.filter((l) => l.itemType === 'cloze' && new Date(l.reviewDate).getTime() >= since);
    const retention =
      recentCardLogs.length > 0
        ? (recentCardLogs.filter((l) => l.rating >= 2).length / recentCardLogs.length) * 100
        : null;

    // Streak: consecutive days with at least one review or reading session, ending
    // today (or yesterday, if nothing has been done yet today).
    const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const activeDays = new Set(logs.map((l) => dayKey(new Date(l.reviewDate))));
    const cursor = new Date();
    if (!activeDays.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (activeDays.has(dayKey(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }

    return {
      totalDocuments: docs.length,
      totalExtracts: extracts.length,
      totalClozes: clozes.length,
      dueTodayCount: dueDocs + dueExtracts + dueClozes,
      reviewsCompletedToday: todayReviews.length,
      averageRetention: retention === null ? null : Number(retention.toFixed(1)),
      streakDays: streak,
    };
  }

  static exportBackup(): string {
    const backup = {
      app: 'foliole',
      version: 2,
      exportedAt: new Date().toISOString(),
      documents: this.getDocuments(),
      extracts: this.getExtracts(),
      clozes: this.getClozes(),
      logs: this.getReviewLogs(),
      settings: this.getSettings(),
      folders: this.getFolders(),
    };
    return JSON.stringify(backup, null, 2);
  }

  /**
   * Replaces the whole library with the content of a backup (exported JSON or an
   * automatic snapshot). Nothing is written unless the file is fully valid.
   */
  static importBackup(jsonString: string): RestoreResult {
    let data: any;
    try {
      data = JSON.parse(jsonString);
    } catch {
      return { ok: false, error: "Ce fichier n'est pas un JSON valide." };
    }
    if (!isObject(data)) return { ok: false, error: "Ce fichier n'est pas une sauvegarde Foliole." };
    for (const key of ['documents', 'extracts', 'clozes'] as const) {
      if (!Array.isArray(data[key])) {
        return { ok: false, error: `Sauvegarde incomplète : la liste « ${key} » est absente ou invalide.` };
      }
    }
    if (data.logs !== undefined && !Array.isArray(data.logs)) return { ok: false, error: 'Historique de révision invalide.' };
    if (data.folders !== undefined && !Array.isArray(data.folders)) return { ok: false, error: 'Liste de dossiers invalide.' };
    if (data.settings !== undefined && !isObject(data.settings)) return { ok: false, error: 'Réglages invalides.' };

    // A restore deliberately replaces unreadable collections too.
    unreadable.clear();
    save('documents', data.documents);
    save('extracts', data.extracts);
    save('clozes', data.clozes);
    save('reviewLogs', data.logs ?? []);
    if (data.settings) save('settings', { ...DEFAULT_SETTINGS, ...data.settings });
    const folders: string[] = data.folders ?? [];
    // Make sure every folder referenced by an item exists in the tree.
    for (const item of [...data.documents, ...data.extracts, ...data.clozes]) {
      if (item && typeof item.folder === 'string') folders.push(item.folder);
    }
    this.saveFolders(folders.length > 0 ? folders : ['Général']);
    return {
      ok: true,
      counts: { documents: data.documents.length, extracts: data.extracts.length, clozes: data.clozes.length },
    };
  }

  static resetToSamples(): void {
    unreadable.clear();
    this.saveDocuments(SAMPLE_DOCUMENTS);
    this.saveExtracts(SAMPLE_EXTRACTS);
    this.saveClozes(SAMPLE_CLOZES);
    save('reviewLogs', []);
  }
}

export const FolioleStorage = GemmaStorage;

