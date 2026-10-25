import { DocumentItem, ExtractItem, ClozeItem, ReviewLog, GemmaStats, FolioleStats } from '../types/foliole';
import { SAMPLE_DOCUMENTS, SAMPLE_EXTRACTS, SAMPLE_CLOZES } from './sampleData';

const STORAGE_KEYS = {
  DOCUMENTS: 'gemma_documents_fr_v2',
  DOCUMENTS_LEGACY: 'foliole_documents_fr_v2',
  EXTRACTS: 'gemma_extracts_fr_v2',
  EXTRACTS_LEGACY: 'foliole_extracts_fr_v2',
  CLOZES: 'gemma_clozes_fr_v2',
  CLOZES_LEGACY: 'foliole_clozes_fr_v2',
  REVIEW_LOGS: 'gemma_review_logs_fr_v2',
  REVIEW_LOGS_LEGACY: 'foliole_review_logs_fr_v2',
  SETTINGS: 'gemma_settings_fr_v2',
  SETTINGS_LEGACY: 'foliole_settings_fr_v2',
  FOLDERS: 'gemma_folders_fr_v2',
  FOLDERS_LEGACY: 'foliole_folders_fr_v2',
};

function readStorage(key: string, legacyKey: string): string | null {
  return localStorage.getItem(key) || localStorage.getItem(legacyKey);
}

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

export class GemmaStorage {
  static getDocuments(): DocumentItem[] {
    try {
      const data = readStorage(STORAGE_KEYS.DOCUMENTS, STORAGE_KEYS.DOCUMENTS_LEGACY);
      if (!data) {
        this.saveDocuments(SAMPLE_DOCUMENTS);
        return SAMPLE_DOCUMENTS;
      }
      const parsed: DocumentItem[] = JSON.parse(data);
      const sampleMap = new Map(SAMPLE_DOCUMENTS.map((d) => [d.id, d.folder]));
      return parsed.map((doc) => ({
        ...doc,
        folder: doc.folder || sampleMap.get(doc.id) || 'Général',
      }));
    } catch {
      return SAMPLE_DOCUMENTS;
    }
  }

  static saveDocuments(docs: DocumentItem[]): void {
    const serialized = JSON.stringify(docs);
    localStorage.setItem(STORAGE_KEYS.DOCUMENTS, serialized);
    localStorage.setItem(STORAGE_KEYS.DOCUMENTS_LEGACY, serialized);
  }

  static getExtracts(): ExtractItem[] {
    try {
      const data = readStorage(STORAGE_KEYS.EXTRACTS, STORAGE_KEYS.EXTRACTS_LEGACY);
      if (!data) {
        this.saveExtracts(SAMPLE_EXTRACTS);
        return SAMPLE_EXTRACTS;
      }
      const parsed: ExtractItem[] = JSON.parse(data);
      return parsed.map((ext) => ({
        ...ext,
        folder: ext.folder || 'Général',
      }));
    } catch {
      return SAMPLE_EXTRACTS;
    }
  }

  static saveExtracts(extracts: ExtractItem[]): void {
    const serialized = JSON.stringify(extracts);
    localStorage.setItem(STORAGE_KEYS.EXTRACTS, serialized);
    localStorage.setItem(STORAGE_KEYS.EXTRACTS_LEGACY, serialized);
  }

  static getClozes(): ClozeItem[] {
    try {
      const data = readStorage(STORAGE_KEYS.CLOZES, STORAGE_KEYS.CLOZES_LEGACY);
      if (!data) {
        this.saveClozes(SAMPLE_CLOZES);
        return SAMPLE_CLOZES;
      }
      const parsed: ClozeItem[] = JSON.parse(data);
      return parsed.map((clz) => ({
        ...clz,
        folder: clz.folder || 'Général',
      }));
    } catch {
      return SAMPLE_CLOZES;
    }
  }

  static saveClozes(clozes: ClozeItem[]): void {
    const serialized = JSON.stringify(clozes);
    localStorage.setItem(STORAGE_KEYS.CLOZES, serialized);
    localStorage.setItem(STORAGE_KEYS.CLOZES_LEGACY, serialized);
  }

  static getFolders(): string[] {
    try {
      const data = readStorage(STORAGE_KEYS.FOLDERS, STORAGE_KEYS.FOLDERS_LEGACY);
      if (!data) {
        const defaults = [
          'Apprentissage & Mémoire',
          'Apprentissage & Mémoire/SuperMemo',
          'Apprentissage & Mémoire/Répétition Espacée',
          'Sciences',
          'Sciences/Neurobiologie',
          'Philosophie',
          'Philosophie/Stoïcisme',
          'Général',
        ];
        this.saveFolders(defaults);
        return defaults;
      }
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : ['Général'];
    } catch {
      return ['Général'];
    }
  }

  static saveFolders(folders: string[]): void {
    const unique = Array.from(new Set(folders.filter(Boolean)));
    const serialized = JSON.stringify(unique);
    localStorage.setItem(STORAGE_KEYS.FOLDERS, serialized);
    localStorage.setItem(STORAGE_KEYS.FOLDERS_LEGACY, serialized);
  }

  static getReviewLogs(): ReviewLog[] {
    try {
      const data = readStorage(STORAGE_KEYS.REVIEW_LOGS, STORAGE_KEYS.REVIEW_LOGS_LEGACY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  static appendReviewLog(log: ReviewLog): void {
    const logs = this.getReviewLogs();
    logs.push(log);
    const serialized = JSON.stringify(logs);
    localStorage.setItem(STORAGE_KEYS.REVIEW_LOGS, serialized);
    localStorage.setItem(STORAGE_KEYS.REVIEW_LOGS_LEGACY, serialized);
  }

  static getSettings(): AppSettings {
    try {
      const data = readStorage(STORAGE_KEYS.SETTINGS, STORAGE_KEYS.SETTINGS_LEGACY);
      return data ? { ...DEFAULT_SETTINGS, ...JSON.parse(data) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  static saveSettings(settings: AppSettings): void {
    const serialized = JSON.stringify(settings);
    localStorage.setItem(STORAGE_KEYS.SETTINGS, serialized);
    localStorage.setItem(STORAGE_KEYS.SETTINGS_LEGACY, serialized);
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

    // Compute average retention from reviews rated >= 2 (Hard, Good, Easy)
    const successfulReviews = logs.filter(l => l.rating >= 2).length;
    const retention = logs.length > 0 ? (successfulReviews / logs.length) * 100 : 92.4;

    return {
      totalDocuments: docs.length,
      totalExtracts: extracts.length,
      totalClozes: clozes.length,
      dueTodayCount: dueDocs + dueExtracts + dueClozes,
      reviewsCompletedToday: todayReviews.length,
      averageRetention: Number(retention.toFixed(1)),
      streakDays: logs.length > 0 ? 5 : 1,
    };
  }

  static exportBackup(): string {
    const backup = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      documents: this.getDocuments(),
      extracts: this.getExtracts(),
      clozes: this.getClozes(),
      logs: this.getReviewLogs(),
      settings: this.getSettings(),
    };
    return JSON.stringify(backup, null, 2);
  }

  static importBackup(jsonString: string): boolean {
    try {
      const data = JSON.parse(jsonString);
      if (data.documents) this.saveDocuments(data.documents);
      if (data.extracts) this.saveExtracts(data.extracts);
      if (data.clozes) this.saveClozes(data.clozes);
      if (data.logs) localStorage.setItem(STORAGE_KEYS.REVIEW_LOGS, JSON.stringify(data.logs));
      if (data.settings) this.saveSettings(data.settings);
      return true;
    } catch (e) {
      console.error('Failed to import backup:', e);
      return false;
    }
  }

  static resetToSamples(): void {
    this.saveDocuments(SAMPLE_DOCUMENTS);
    this.saveExtracts(SAMPLE_EXTRACTS);
    this.saveClozes(SAMPLE_CLOZES);
    localStorage.removeItem(STORAGE_KEYS.REVIEW_LOGS);
    localStorage.removeItem(STORAGE_KEYS.REVIEW_LOGS_LEGACY);
  }
}

export const FolioleStorage = GemmaStorage;

