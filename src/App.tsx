/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  DocumentItem,
  ExtractItem,
  ClozeItem,
  ActiveTab,
  ReviewRating,
  ItemType,
} from './types/gemma';
import { GemmaStorage, FolioleStorage, AppSettings } from './lib/storage';
import { createInitialFSRSRecord, calculateNextFSRS } from './lib/fsrs';
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

  // Initial load from local-first storage
  useEffect(() => {
    const docs = GemmaStorage.getDocuments();
    const exts = GemmaStorage.getExtracts();
    const clzs = GemmaStorage.getClozes();

    setDocuments(docs);
    setExtracts(exts);
    setClozes(clzs);

    if (docs.length > 0 && !currentDocumentId) {
      setCurrentDocumentId(docs[0].id);
    }
  }, []);

  // Sync state to local storage
  const updateDocuments = (newDocs: DocumentItem[]) => {
    setDocuments(newDocs);
    GemmaStorage.saveDocuments(newDocs);
  };

  const updateExtracts = (newExts: ExtractItem[]) => {
    setExtracts(newExts);
    GemmaStorage.saveExtracts(newExts);
  };

  const updateClozes = (newClzs: ClozeItem[]) => {
    setClozes(newClzs);
    GemmaStorage.saveClozes(newClzs);
  };

  const currentDocument =
    documents.find((d) => d.id === currentDocumentId) || documents[0];

  const logs = GemmaStorage.getReviewLogs();
  const stats = GemmaStorage.computeStats(documents, extracts, clozes, logs);

  // Handler: Create Extract from Reader
  const handleCreateExtract = (docId: string, text: string) => {
    const doc = documents.find((d) => d.id === docId);
    if (!doc) return;

    const newExtract: ExtractItem = {
      id: `ext-${Date.now()}`,
      documentId: doc.id,
      documentTitle: doc.title,
      text,
      tags: [...doc.tags],
      priority: Math.min(100, doc.priority + 5),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      state: 'learning',
      fsrs: createInitialFSRSRecord(1), // due in 1 day
    };

    const newExts = [newExtract, ...extracts];
    updateExtracts(newExts);

    // Update document extracted count
    const updatedDocs = documents.map((d) =>
      d.id === docId ? { ...d, extractedCount: (d.extractedCount || 0) + 1 } : d
    );
    updateDocuments(updatedDocs);
  };

  // Handler: Create Cloze from Reader or Extract
  const handleCreateCloze = (docId: string, text: string) => {
    const doc = documents.find((d) => d.id === docId);

    // Wrap the selected text in a cloze template if not already wrapped
    let clozeText = text;
    if (!text.includes('{{c')) {
      clozeText = `{{c1::${text}}}`;
    }

    const newCloze: ClozeItem = {
      id: `cloze-${Date.now()}`,
      documentId: doc?.id,
      documentTitle: doc?.title || 'Atomic Insight',
      text: clozeText,
      tags: doc ? [...doc.tags] : ['Spaced Repetition'],
      priority: doc ? doc.priority : 85,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      state: 'learning',
      fsrs: createInitialFSRSRecord(1),
    };

    const newClzs = [newCloze, ...clozes];
    updateClozes(newClzs);
  };

  // Handler: Update FSRS Target Retention
  const handleUpdateTargetRetention = (newRetention: number) => {
    const clamped = Math.min(0.98, Math.max(0.70, Number(newRetention.toFixed(2))));
    const newSettings: AppSettings = { ...settings, targetRetention: clamped };
    setSettings(newSettings);
    FolioleStorage.saveSettings(newSettings);
  };

  // Handler: Rate Item (Cloze ou Extrait) in FSRS Review
  const handleRateItem = (type: 'cloze' | 'extract', id: string, rating: ReviewRating) => {
    if (type === 'cloze') {
      const target = clozes.find((c) => c.id === id);
      if (!target) return;

      const prediction = calculateNextFSRS(target.fsrs, rating, new Date(), settings.targetRetention);

      const updatedCloze: ClozeItem = {
        ...target,
        updatedAt: new Date().toISOString(),
        fsrs: {
          stability: prediction.stability,
          difficulty: prediction.difficulty,
          reps: target.fsrs.reps + 1,
          lapses: target.fsrs.lapses + (rating === 1 ? 1 : 0),
          lastReview: new Date().toISOString(),
          nextReviewDate: prediction.nextReviewDate,
          interval: prediction.interval,
        },
      };

      const updatedList = clozes.map((c) => (c.id === id ? updatedCloze : c));
      updateClozes(updatedList);

      FolioleStorage.appendReviewLog({
        id: `log-${Date.now()}`,
        itemId: id,
        itemType: 'cloze',
        rating,
        scheduledInterval: prediction.interval,
        actualInterval: target.fsrs.interval,
        reviewDate: new Date().toISOString(),
        state: updatedCloze.state,
      });
    } else if (type === 'extract') {
      const target = extracts.find((e) => e.id === id);
      if (!target) return;

      const prediction = calculateNextFSRS(target.fsrs, rating, new Date(), settings.targetRetention);

      const updatedExtract: ExtractItem = {
        ...target,
        updatedAt: new Date().toISOString(),
        fsrs: {
          stability: prediction.stability,
          difficulty: prediction.difficulty,
          reps: target.fsrs.reps + 1,
          lapses: target.fsrs.lapses + (rating === 1 ? 1 : 0),
          lastReview: new Date().toISOString(),
          nextReviewDate: prediction.nextReviewDate,
          interval: prediction.interval,
        },
      };

      const updatedList = extracts.map((e) => (e.id === id ? updatedExtract : e));
      updateExtracts(updatedList);

      FolioleStorage.appendReviewLog({
        id: `log-${Date.now()}`,
        itemId: id,
        itemType: 'extract',
        rating,
        scheduledInterval: prediction.interval,
        actualInterval: target.fsrs.interval,
        reviewDate: new Date().toISOString(),
        state: updatedExtract.state,
      });
    }
  };

  // Handler: Postpone Item
  const handlePostponeItem = (type: ItemType, id: string, days: number) => {
    const newDate = new Date(Date.now() + days * 86400000).toISOString();

    if (type === 'document') {
      updateDocuments(
        documents.map((d) =>
          d.id === id ? { ...d, fsrs: { ...d.fsrs, nextReviewDate: newDate } } : d
        )
      );
    } else if (type === 'extract') {
      updateExtracts(
        extracts.map((e) =>
          e.id === id ? { ...e, fsrs: { ...e.fsrs, nextReviewDate: newDate } } : e
        )
      );
    } else if (type === 'cloze') {
      updateClozes(
        clozes.map((c) =>
          c.id === id ? { ...c, fsrs: { ...c.fsrs, nextReviewDate: newDate } } : c
        )
      );
    }
  };

  // Handler: Update Priority
  const handleUpdatePriority = (type: ItemType, id: string, newPriority: number) => {
    if (type === 'document') {
      updateDocuments(
        documents.map((d) => (d.id === id ? { ...d, priority: newPriority } : d))
      );
    } else if (type === 'extract') {
      updateExtracts(
        extracts.map((e) => (e.id === id ? { ...e, priority: newPriority } : e))
      );
    } else if (type === 'cloze') {
      updateClozes(
        clozes.map((c) => (c.id === id ? { ...c, priority: newPriority } : c))
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
      updateDocuments(
        documents.map((d) => (d.id === id ? { ...d, state: 'dismissed' } : d))
      );
    } else if (type === 'extract') {
      updateExtracts(
        extracts.map((e) => (e.id === id ? { ...e, state: 'dismissed' } : e))
      );
    } else if (type === 'cloze') {
      updateClozes(
        clozes.map((c) => (c.id === id ? { ...c, state: 'dismissed' } : c))
      );
    }
  };

  // Handler: Update Reading Progress
  const handleUpdateProgress = (docId: string, progress: number, offset: number) => {
    updateDocuments(
      documents.map((d) =>
        d.id === docId
          ? { ...d, readingProgress: progress, lastReadOffset: offset }
          : d
      )
    );
  };

  // Export JSON Backup
  const handleExportBackup = () => {
    const jsonStr = GemmaStorage.exportBackup();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `foliole-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export Markdown Mirror (format Obsidian)
  const handleExportMarkdownMirror = () => {
    let combinedMd = `# Miroir de Voûte Foliole (Lecture Incrémentale)\nExporté le : ${new Date().toLocaleString('fr-FR')}\n\n`;

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
    a.download = `foliole-markdown-mirror-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Reset to default sample library
  const handleResetDemo = () => {
    GemmaStorage.resetToSamples();
    setDocuments(GemmaStorage.getDocuments());
    setExtracts(GemmaStorage.getExtracts());
    setClozes(GemmaStorage.getClozes());
    setActiveTab('queue');
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
              onCreateExtract={handleCreateExtract}
              onCreateCloze={handleCreateCloze}
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
            onRateItem={handleRateItem}
            onCreateClozeFromExtract={(docId, text) => handleCreateCloze(docId, text)}
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
            onExportBackup={handleExportBackup}
            onExportMarkdownMirror={handleExportMarkdownMirror}
            onResetDemo={handleResetDemo}
          />
        )}
      </main>

      {/* Source Import Modal */}
      <ImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onAddDocument={(newDoc) => {
          const newDocs = [newDoc, ...documents];
          updateDocuments(newDocs);
          setCurrentDocumentId(newDoc.id);
          setActiveTab('reader');
        }}
      />
    </div>
  );
}
