/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  DocumentItem,
  ExtractItem,
  ClozeItem,
  ActiveTab,
  ReviewRating,
  ItemType,
  ItemState,
  FSRSRecord,
} from './types/gemma';
import { GemmaStorage, AppSettings } from './lib/storage';
import { onStorageError, isDesktop, dataLocation, takeSnapshot, openDataFolder } from './lib/kv';
import { createInitialFSRSRecord, applyCardReview, applyTopicReview, firstTopicInterval } from './lib/fsrs';
import { TopNav } from './components/TopNav';
import { QueueView } from './components/QueueView';
import { ReaderView } from './components/ReaderView';
import { ReviewModal } from './components/ReviewModal';
import { LibraryView } from './components/LibraryView';
import { StatsView } from './components/StatsView';
import { ImportModal } from './components/ImportModal';

export default function App() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [extracts, setExtracts] = useState<ExtractItem[]>([]);
  const [clozes, setClozes] = useState<ClozeItem[]>([]);
  const [settings, setSettings] = useState<AppSettings>(() => GemmaStorage.getSettings());
  const [activeTab, setActiveTab] = useState<ActiveTab>('queue');
  const [currentDocumentId, setCurrentDocumentId] = useState<string>('');
  const [reviewClozeId, setReviewClozeId] = useState<string | undefined>(undefined);

  // Modals & Panels
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [storageErrors, setStorageErrors] = useState<string[]>([]);

  useEffect(
    () =>
      onStorageError((message) =>
        setStorageErrors((prev) => (prev.includes(message) ? prev : [...prev, message]))
      ),
    []
  );

  // Initial load from local-first storage
  useEffect(() => {
    const docs = GemmaStorage.getDocuments();
    const exts = GemmaStorage.getExtracts();
    const clzs = GemmaStorage.getClozes();

    documentsRef.current = docs;
    extractsRef.current = exts;
    clozesRef.current = clzs;
    setDocuments(docs);
    setExtracts(exts);
    setClozes(clzs);

    if (docs.length > 0 && !currentDocumentId) {
      setCurrentDocumentId(docs[0].id);
    }
  }, []);

  // Sync state to storage. Updates read the latest state from refs so delayed
  // callbacks (debounced progress saves, etc.) never overwrite newer changes.
  const documentsRef = useRef(documents);
  const extractsRef = useRef(extracts);
  const clozesRef = useRef(clozes);

  type Update<T> = T[] | ((prev: T[]) => T[]);

  const updateDocuments = (next: Update<DocumentItem>) => {
    const value = typeof next === 'function' ? next(documentsRef.current) : next;
    documentsRef.current = value;
    setDocuments(value);
    GemmaStorage.saveDocuments(value);
  };

  const updateExtracts = (next: Update<ExtractItem>) => {
    const value = typeof next === 'function' ? next(extractsRef.current) : next;
    extractsRef.current = value;
    setExtracts(value);
    GemmaStorage.saveExtracts(value);
  };

  const updateClozes = (next: Update<ClozeItem>) => {
    const value = typeof next === 'function' ? next(clozesRef.current) : next;
    clozesRef.current = value;
    setClozes(value);
    GemmaStorage.saveClozes(value);
  };

  const currentDocument =
    documents.find((d) => d.id === currentDocumentId) || documents[0];

  const logs = GemmaStorage.getReviewLogs();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const reviewedTodayIds = new Set(
    logs.filter((l) => l.itemType === 'cloze' && new Date(l.reviewDate) >= startOfToday).map((l) => l.itemId)
  );
  const stats = GemmaStorage.computeStats(documents, extracts, clozes, logs);

  const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Handler: Create Extract (from a document in the reader, or from another extract)
  const handleCreateExtract = (source: { documentId: string; parentExtractId?: string }, text: string) => {
    const doc = documentsRef.current.find((d) => d.id === source.documentId);
    const parent = source.parentExtractId
      ? extractsRef.current.find((e) => e.id === source.parentExtractId)
      : undefined;
    if (!doc && !parent) return;

    const basePriority = parent ? parent.priority : doc!.priority;
    const priority = Math.min(100, basePriority + 5);
    const now = new Date().toISOString();
    const newExtract: ExtractItem = {
      id: newId('ext'),
      documentId: source.documentId,
      documentTitle: parent?.documentTitle ?? doc!.title,
      parentExtractId: parent?.id,
      folder: parent?.folder ?? doc?.folder,
      text,
      tags: [...(parent?.tags ?? doc?.tags ?? [])],
      priority,
      createdAt: now,
      updatedAt: now,
      state: 'new',
      fsrs: createInitialFSRSRecord(firstTopicInterval(priority)),
    };
    updateExtracts((prev) => [newExtract, ...prev]);

    if (doc) {
      updateDocuments((prev) =>
        prev.map((d) => (d.id === doc.id ? { ...d, extractedCount: (d.extractedCount || 0) + 1 } : d))
      );
    }
  };

  // Handler: Create Cloze card. `clozeText` already contains the {{c1::...}} deletion.
  const handleCreateCloze = (source: { documentId?: string; extractId?: string }, clozeText: string) => {
    const ext = source.extractId ? extractsRef.current.find((e) => e.id === source.extractId) : undefined;
    const docId = source.documentId ?? ext?.documentId;
    const doc = docId ? documentsRef.current.find((d) => d.id === docId) : undefined;
    const now = new Date().toISOString();

    const newCloze: ClozeItem = {
      id: newId('cloze'),
      documentId: doc?.id ?? docId,
      extractId: ext?.id,
      documentTitle: ext?.documentTitle ?? doc?.title ?? 'Note',
      folder: ext?.folder ?? doc?.folder,
      text: clozeText,
      tags: [...(ext?.tags ?? doc?.tags ?? [])],
      priority: ext?.priority ?? doc?.priority ?? 85,
      createdAt: now,
      updatedAt: now,
      state: 'new',
      fsrs: createInitialFSRSRecord(0), // available for review right away
    };
    updateClozes((prev) => [newCloze, ...prev]);
  };

  // Handler: Update FSRS Target Retention
  const handleUpdateTargetRetention = (newRetention: number) => {
    const clamped = Math.min(0.98, Math.max(0.70, Number(newRetention.toFixed(2))));
    const newSettings: AppSettings = { ...settings, targetRetention: clamped };
    setSettings(newSettings);
    GemmaStorage.saveSettings(newSettings);
  };

  const handleUpdateDailyLimit = (limit: number) => {
    const newSettings: AppSettings = { ...settings, dailyReviewLimit: Math.max(1, Math.min(999, Math.round(limit))) };
    setSettings(newSettings);
    GemmaStorage.saveSettings(newSettings);
  };

  // Handler: Rate a cloze card (FSRS). Returns the new scheduling record.
  const handleRateCard = (id: string, rating: ReviewRating): FSRSRecord | undefined => {
    const target = clozesRef.current.find((c) => c.id === id);
    if (!target) return undefined;
    const now = new Date();
    const fsrs = applyCardReview(target.fsrs, rating, now, settings.targetRetention);
    const state: ItemState = fsrs.phase === 'review' ? 'review' : 'learning';
    updateClozes((prev) =>
      prev.map((c) => (c.id === id ? { ...c, fsrs, state, updatedAt: now.toISOString() } : c))
    );
    GemmaStorage.appendReviewLog({
      id: newId('log'),
      itemId: id,
      itemType: 'cloze',
      rating,
      scheduledInterval: fsrs.interval,
      actualInterval: target.fsrs.lastReview
        ? (now.getTime() - new Date(target.fsrs.lastReview).getTime()) / 86400000
        : 0,
      reviewDate: now.toISOString(),
      state,
    });
    return fsrs;
  };

  // Handler: done reading a document or extract for now ("Suivant"): reschedule it
  // with an interval that grows according to its priority. Returns the interval in days.
  const handleTopicNext = (type: 'document' | 'extract', id: string): number | undefined => {
    const now = new Date();
    const list: Array<DocumentItem | ExtractItem> = type === 'document' ? documentsRef.current : extractsRef.current;
    const target = list.find((i) => i.id === id);
    if (!target) return undefined;
    const fsrs = applyTopicReview(target.fsrs, target.priority, now);
    const patch = { fsrs, state: 'review' as ItemState, updatedAt: now.toISOString() };
    if (type === 'document') {
      updateDocuments((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    } else {
      updateExtracts((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    }
    GemmaStorage.appendReviewLog({
      id: newId('log'),
      itemId: id,
      itemType: type,
      rating: 3,
      scheduledInterval: fsrs.interval,
      actualInterval: target.fsrs.lastReview
        ? (now.getTime() - new Date(target.fsrs.lastReview).getTime()) / 86400000
        : 0,
      reviewDate: now.toISOString(),
      state: 'review',
    });
    return fsrs.interval;
  };

  // Opens the highest-priority document due today (other than `excludeId`),
  // or goes back to the queue when there is nothing left to read.
  const openNextDueDocument = (excludeId: string) => {
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const next = documentsRef.current
      .filter((d) => d.id !== excludeId && d.state !== 'dismissed' && new Date(d.fsrs.nextReviewDate) <= endOfToday)
      .sort((a, b) => b.priority - a.priority)[0];
    if (next) {
      setCurrentDocumentId(next.id);
      window.scrollTo({ top: 0 });
    } else {
      setActiveTab('queue');
    }
  };

  // Handler: Postpone Item
  const handlePostponeItem = (type: ItemType, id: string, days: number) => {
    const newDate = new Date(Date.now() + days * 86400000).toISOString();

    if (type === 'document') {
      updateDocuments((prev) =>
        prev.map((d) =>
          d.id === id ? { ...d, fsrs: { ...d.fsrs, nextReviewDate: newDate } } : d
        )
      );
    } else if (type === 'extract') {
      updateExtracts((prev) =>
        prev.map((e) =>
          e.id === id ? { ...e, fsrs: { ...e.fsrs, nextReviewDate: newDate } } : e
        )
      );
    } else if (type === 'cloze') {
      updateClozes((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, fsrs: { ...c.fsrs, nextReviewDate: newDate } } : c
        )
      );
    }
  };

  // Handler: Update Priority
  const handleUpdatePriority = (type: ItemType, id: string, newPriority: number) => {
    if (type === 'document') {
      updateDocuments((prev) =>
        prev.map((d) => (d.id === id ? { ...d, priority: newPriority } : d))
      );
    } else if (type === 'extract') {
      updateExtracts((prev) =>
        prev.map((e) => (e.id === id ? { ...e, priority: newPriority } : e))
      );
    } else if (type === 'cloze') {
      updateClozes((prev) =>
        prev.map((c) => (c.id === id ? { ...c, priority: newPriority } : c))
      );
    }
  };

  // Handler: Delete Document (with cascade delete of associated extracts and clozes)
  const handleDeleteDocument = (docId: string) => {
    const updatedDocs = documents.filter((d) => d.id !== docId);
    updateDocuments(updatedDocs);

    // Supprimer également tous les extraits issus de ce document
    const updatedExtracts = extracts.filter((e) => e.documentId !== docId);
    updateExtracts(updatedExtracts);

    // Supprimer également toutes les cartes cloze issues de ce document
    const updatedClozes = clozes.filter((c) => c.documentId !== docId);
    updateClozes(updatedClozes);

    if (currentDocumentId === docId) {
      setCurrentDocumentId(updatedDocs.length > 0 ? updatedDocs[0].id : '');
    }
  };

  // Handler: Update Document (Content, Title, Author, Tags, Priority, Format, etc.)
  const handleUpdateDocument = (updatedDoc: DocumentItem) => {
    const oldDoc = documents.find((d) => d.id === updatedDoc.id);
    const newDocs = documents.map((d) => (d.id === updatedDoc.id ? updatedDoc : d));
    updateDocuments(newDocs);

    // Synchroniser le titre sur les extraits et clozes associés si le titre a changé
    if (oldDoc && oldDoc.title !== updatedDoc.title) {
      const newExtracts = extracts.map((e) =>
        e.documentId === updatedDoc.id ? { ...e, documentTitle: updatedDoc.title } : e
      );
      updateExtracts(newExtracts);

      const newClozes = clozes.map((c) =>
        c.documentId === updatedDoc.id ? { ...c, documentTitle: updatedDoc.title } : c
      );
      updateClozes(newClozes);
    }
  };

  // Handler: Delete Extract
  const handleDeleteExtract = (extractId: string) => {
    const updatedExtracts = extracts.filter((e) => e.id !== extractId);
    updateExtracts(updatedExtracts);
  };

  // Handler: Delete Cloze
  const handleDeleteCloze = (clozeId: string) => {
    const updatedClozes = clozes.filter((c) => c.id !== clozeId);
    updateClozes(updatedClozes);
  };

  // Handler: Delete Any Item (Document, Extrait ou Cloze)
  const handleDeleteItem = (type: ItemType, id: string) => {
    if (type === 'document') {
      handleDeleteDocument(id);
    } else if (type === 'extract') {
      handleDeleteExtract(id);
    } else if (type === 'cloze') {
      handleDeleteCloze(id);
    }
  };

  // Handler: Dismiss Item
  const handleDismissItem = (type: ItemType, id: string) => {
    if (type === 'document') {
      updateDocuments((prev) =>
        prev.map((d) => (d.id === id ? { ...d, state: 'dismissed' } : d))
      );
    } else if (type === 'extract') {
      updateExtracts((prev) =>
        prev.map((e) => (e.id === id ? { ...e, state: 'dismissed' } : e))
      );
    } else if (type === 'cloze') {
      updateClozes((prev) =>
        prev.map((c) => (c.id === id ? { ...c, state: 'dismissed' } : c))
      );
    }
  };

  // Handler: Update Reading Progress (called debounced by the reader)
  const handleUpdateProgress = useCallback((docId: string, progress: number, offset: number) => {
    updateDocuments((prev) =>
      prev.map((d) => (d.id === docId ? { ...d, readingProgress: progress, lastReadOffset: offset } : d))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Export JSON Backup
  const handleExportBackup = () => {
    const jsonStr = GemmaStorage.exportBackup();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gemma-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export Markdown Mirror (format Obsidian)
  const handleExportMarkdownMirror = () => {
    let combinedMd = `# Miroir de Voûte Gemma (Lecture Incrémentale)\nExporté le : ${new Date().toLocaleString('fr-FR')}\n\n`;

    documents.forEach((doc) => {
      combinedMd += `## ${doc.title}\n`;
      combinedMd += `Auteur : ${doc.author || 'Inconnu'}\n`;
      combinedMd += `Priorité : ${doc.priority}%\n`;
      combinedMd += `Tags : ${doc.tags.join(', ')}\n\n`;
      combinedMd += `${doc.content}\n\n`;

      const docExts = extracts.filter((e) => e.documentId === doc.id);
      if (docExts.length > 0) {
        combinedMd += `### Extraits (${docExts.length})\n`;
        docExts.forEach((ext) => {
          combinedMd += `> ${ext.text}\n\n`;
        });
      }
      combinedMd += `---\n\n`;
    });

    const blob = new Blob([combinedMd], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gemma-markdown-mirror-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reloadFromStorage = () => {
    const docs = GemmaStorage.getDocuments();
    const exts = GemmaStorage.getExtracts();
    const clzs = GemmaStorage.getClozes();
    documentsRef.current = docs;
    extractsRef.current = exts;
    clozesRef.current = clzs;
    setDocuments(docs);
    setExtracts(exts);
    setClozes(clzs);
    setSettings(GemmaStorage.getSettings());
    setCurrentDocumentId(docs[0]?.id ?? '');
  };

  // Snapshot of the current library before an action that replaces it.
  const snapshotBefore = async (reason: string): Promise<string | null> => {
    try {
      await takeSnapshot(reason);
      return null;
    } catch (e) {
      return `Impossible de créer la sauvegarde de sécurité : ${e instanceof Error ? e.message : e}`;
    }
  };

  // Restore a JSON backup (manual export or automatic snapshot)
  const handleRestoreBackup = async (file: File): Promise<{ ok: boolean; message: string }> => {
    let text: string;
    try {
      text = await file.text();
    } catch {
      return { ok: false, message: 'Lecture du fichier impossible.' };
    }
    const snapshotError = await snapshotBefore('avant-restauration');
    if (snapshotError) return { ok: false, message: snapshotError };
    const result = GemmaStorage.importBackup(text);
    if (!result.ok) return { ok: false, message: result.error };
    reloadFromStorage();
    const { documents: d, extracts: e, clozes: c } = result.counts;
    return { ok: true, message: `Sauvegarde restaurée : ${d} documents, ${e} extraits, ${c} cartes` };
  };

  // Reset to default sample library
  const handleResetDemo = async (): Promise<boolean> => {
    const snapshotError = await snapshotBefore('avant-reinitialisation');
    if (snapshotError) {
      setStorageErrors((prev) => [...prev, snapshotError]);
      return false;
    }
    GemmaStorage.resetToSamples();
    reloadFromStorage();
    setActiveTab('queue');
    return true;
  };

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#28231D] flex flex-col selection:bg-[#EBE2D3] selection:text-[#28231D]">
      {/* 3-Zone Top Navigation Contract */}
      <TopNav
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setReviewClozeId(undefined);
        }}
        dueCount={stats.dueTodayCount}
        onOpenImport={() => setIsImportOpen(true)}
      />

      {storageErrors.length > 0 && (
        <div role="alert" className="bg-[#FDF2F0] border-b border-[#F2D6D3] text-[#8F352B] text-xs">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-start justify-between gap-4">
            <ul className="space-y-1">
              {storageErrors.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setStorageErrors([])}
              className="shrink-0 px-2 py-0.5 rounded-md hover:bg-[#F2D6D3] font-medium"
            >
              Masquer
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1">
        {activeTab === 'queue' && (
          <QueueView
            documents={documents}
            extracts={extracts}
            clozes={clozes}
            onSelectDocument={(doc) => {
              setCurrentDocumentId(doc.id);
              setActiveTab('reader');
            }}
            onStartReview={(clozeId) => {
              setReviewClozeId(clozeId);
              setActiveTab('review');
            }}
            onDeleteItem={handleDeleteItem}
            onOpenImport={() => setIsImportOpen(true)}
          />
        )}

        {activeTab === 'reader' && currentDocument && (() => {
          const activeDocs = documents.filter((d) => d.state !== 'dismissed');
          const currentDocIndex = activeDocs.findIndex((d) => d.id === currentDocument.id);
          const validIndex = currentDocIndex >= 0 ? currentDocIndex : 0;

          return (
            <ReaderView
              currentDocument={currentDocument}
              allDocuments={activeDocs}
              extracts={extracts}
              onSelectDocument={(doc) => {
                setCurrentDocumentId(doc.id);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onUpdateDocument={handleUpdateDocument}
              onCreateExtract={(docId, text) => handleCreateExtract({ documentId: docId }, text)}
              onCreateCloze={(docId, clozeText) => handleCreateCloze({ documentId: docId }, clozeText)}
              onFinishReading={(docId) => {
                handleTopicNext('document', docId);
                openNextDueDocument(docId);
              }}
              onRetireDocument={(docId) => {
                handleDismissItem('document', docId);
                openNextDueDocument(docId);
              }}
              onUpdateProgress={handleUpdateProgress}
              onPostponeDocument={(docId, days) =>
                handlePostponeItem('document', docId, days)
              }
              onNextQueueItem={() => {
                if (activeDocs.length > 0) {
                  const nextIdx = (validIndex + 1) % activeDocs.length;
                  setCurrentDocumentId(activeDocs[nextIdx].id);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }
              }}
              onPrevQueueItem={() => {
                if (activeDocs.length > 0) {
                  const prevIdx = (validIndex - 1 + activeDocs.length) % activeDocs.length;
                  setCurrentDocumentId(activeDocs[prevIdx].id);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }
              }}
              currentIndex={validIndex}
              totalDocuments={activeDocs.length}
            />
          );
        })()}

        {activeTab === 'review' && (
          <ReviewModal
            clozes={clozes}
            extracts={extracts}
            initialItemId={reviewClozeId}
            targetRetention={settings.targetRetention}
            onRateCard={handleRateCard}
            onExtractNext={(id) => handleTopicNext('extract', id)}
            onRetireExtract={(id) => handleDismissItem('extract', id)}
            onCreateExtractFromExtract={(extractId, text) => {
              const parent = extractsRef.current.find((e) => e.id === extractId);
              if (parent) handleCreateExtract({ documentId: parent.documentId, parentExtractId: extractId }, text);
            }}
            onCreateClozeFromExtract={(extractId, clozeText) => handleCreateCloze({ extractId }, clozeText)}
            dailyLimit={settings.dailyReviewLimit}
            reviewedTodayIds={reviewedTodayIds}
            onClose={() => setActiveTab('queue')}
            onNavigateToDocument={(docId) => {
              setCurrentDocumentId(docId);
              setActiveTab('reader');
            }}
          />
        )}

        {activeTab === 'library' && (
          <LibraryView
            documents={documents}
            extracts={extracts}
            clozes={clozes}
            onSelectDocument={(doc) => {
              setCurrentDocumentId(doc.id);
              setActiveTab('reader');
            }}
            onUpdateDocument={handleUpdateDocument}
            onDeleteDocument={handleDeleteDocument}
            onDeleteExtract={handleDeleteExtract}
            onDeleteCloze={handleDeleteCloze}
            onStartReviewWithFolder={(folder) => {
              const docIds = new Set(
                documents
                  .filter((d) => (d.folder || 'Général') === folder || (d.folder || 'Général').startsWith(`${folder}/`))
                  .map((d) => d.id)
              );
              const targetCloze = clozes.find(
                (c) => (c.documentId && docIds.has(c.documentId)) || c.folder === folder || (c.folder || '').startsWith(`${folder}/`)
              );
              if (targetCloze) {
                setReviewClozeId(targetCloze.id);
              }
              setActiveTab('review');
            }}
            onOpenImport={() => setIsImportOpen(true)}
            onExportMarkdown={handleExportMarkdownMirror}
            onExportBackup={handleExportBackup}
          />
        )}

        {activeTab === 'stats' && (
          <StatsView
            stats={stats}
            documents={documents}
            extracts={extracts}
            clozes={clozes}
            targetRetention={settings.targetRetention}
            onUpdateTargetRetention={handleUpdateTargetRetention}
            dailyReviewLimit={settings.dailyReviewLimit}
            onUpdateDailyLimit={handleUpdateDailyLimit}
            onExportBackup={handleExportBackup}
            onExportMarkdownMirror={handleExportMarkdownMirror}
            onResetDemo={handleResetDemo}
            onRestoreBackup={handleRestoreBackup}
            onOpenDataFolder={isDesktop ? openDataFolder : undefined}
            dataLocation={dataLocation}
          />
        )}
      </main>

      {/* Source Import Modal */}
      <ImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onAddDocument={(newDoc) => {
          updateDocuments((prev) => [newDoc, ...prev]);
          setCurrentDocumentId(newDoc.id);
          setActiveTab('reader');
        }}
        onAddDocuments={(newDocs) => {
          if (newDocs.length === 0) return;
          updateDocuments((prev) => [...newDocs, ...prev]);
          GemmaStorage.saveFolders([...GemmaStorage.getFolders(), ...newDocs.map((d) => d.folder || 'Général')]);
          setCurrentDocumentId(newDocs[0].id);
          setActiveTab('reader');
        }}
      />
    </div>
  );
}
