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
} from './types/saudade';
import { SaudadeStorage, AppSettings } from './lib/storage';
import { applyTheme } from './lib/theme';
import { buildTodayQueue, isDueToday, nextAfterToday, topicSurplus, postponeTopic, cardBacklog } from './lib/queue';
import { locatePassage, replacePassage } from './lib/sourceSync';
import { ItemEditor } from './components/ItemEditor';
import { ItemViewer } from './components/ItemViewer';
import { cardsForNewNote, applyNote, noteKeyOf, cardPassages } from './lib/clozeNotes';
import { isImageCard, isQA } from './lib/cards';
import { OcclusionEditor, OcclusionNote } from './components/OcclusionEditor';
import { fetchImage } from './lib/importers';
import { isLeech, lapseMakesLeech } from './lib/leech';
import { isWriting } from './lib/formats';
import { installUpdate, useUpdates } from './lib/updates';
import { isMobileApp } from './lib/platform';
import { parseClozes } from './lib/math';
import { onStorageError, isDesktop, dataLocation, takeSnapshot, openDataFolder } from './lib/kv';
import { createInitialFSRSRecord, applyCardReview, applyTopicReview, firstTopicInterval } from './lib/fsrs';
import { TopNav } from './components/TopNav';
import { QueueView } from './components/QueueView';
import { ReaderView } from './components/ReaderView';
import { ReviewModal } from './components/ReviewModal';
import { LibraryView } from './components/LibraryView';
import { StatsView } from './components/StatsView';
import { SettingsView } from './components/SettingsView';
import { onLibraryChanged, syncNow, getStatus as getSyncStatus } from './lib/sync/client';
import { ImportModal } from './components/ImportModal';

export default function App() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [extracts, setExtracts] = useState<ExtractItem[]>([]);
  const [clozes, setClozes] = useState<ClozeItem[]>([]);
  const [settings, setSettings] = useState<AppSettings>(() => SaudadeStorage.getSettings());
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
    const docs = SaudadeStorage.getDocuments();
    const exts = SaudadeStorage.getExtracts();
    const clzs = SaudadeStorage.getClozes();

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

  // Synchronisation: reload what other computers changed; fetch their changes at
  // start, when the window comes back to the front, and every two minutes.
  useEffect(() => {
    const reload = () => {
      documentsRef.current = SaudadeStorage.getDocuments();
      extractsRef.current = SaudadeStorage.getExtracts();
      clozesRef.current = SaudadeStorage.getClozes();
      setDocuments(documentsRef.current);
      setExtracts(extractsRef.current);
      setClozes(clozesRef.current);
      const synced = SaudadeStorage.getSettings();
      setSettings(synced);
      applyTheme(synced.theme);
    };
    const off = onLibraryChanged(reload);
    // Changes from other computers first, then the morning's postponement.
    const tick = async () => {
      if (getSyncStatus()?.enabled) await syncNow().catch((e) => console.error('Synchronisation :', e));
      postponeSurplusRef.current(true);
    };
    tick();
    const timer = window.setInterval(tick, 2 * 60 * 1000);
    window.addEventListener('focus', tick);
    return () => {
      off();
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
    };
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
    SaudadeStorage.saveDocuments(value);
  };

  const updateExtracts = (next: Update<ExtractItem>) => {
    const value = typeof next === 'function' ? next(extractsRef.current) : next;
    extractsRef.current = value;
    setExtracts(value);
    SaudadeStorage.saveExtracts(value);
  };

  const updateClozes = (next: Update<ClozeItem>) => {
    const value = typeof next === 'function' ? next(clozesRef.current) : next;
    clozesRef.current = value;
    setClozes(value);
    SaudadeStorage.saveClozes(value);
  };

  const currentDocument =
    documents.find((d) => d.id === currentDocumentId) || documents[0];

  const logs = SaudadeStorage.getReviewLogs();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const reviewedTodayIds = new Set(
    logs.filter((l) => l.itemType === 'cloze' && new Date(l.reviewDate) >= startOfToday).map((l) => l.itemId)
  );
  const stats = SaudadeStorage.computeStats(documents, extracts, clozes, logs);
  // Today's queue: what the reading queue lists, the review session plays and the
  // badge counts. Empty once everything due today is done.
  const todayQueue = buildTodayQueue({
    documents,
    extracts,
    clozes,
    dailyLimit: settings.dailyReviewLimit,
    topicLimit: settings.dailyTopicLimit,
    shuffle: settings.shuffleQueue,
    reviewedTodayIds,
  });
  // Beyond today's limits: shown in the queue, the documents and extracts postponed.
  const overload = {
    topics: topicSurplus(documents, extracts, settings.dailyTopicLimit).length,
    cards: cardBacklog(clozes, todayQueue),
  };
  const nextDueDate = nextAfterToday([documents, extracts, clozes]);

  const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
      // Position of the passage in the document, to find it again when the extract is edited.
      sourceStart: doc ? locatePassage(doc.content, text)?.start : undefined,
    };
    updateExtracts((prev) => [newExtract, ...prev]);

    if (doc) {
      updateDocuments((prev) =>
        prev.map((d) => (d.id === doc.id ? { ...d, extractedCount: (d.extractedCount || 0) + 1 } : d))
      );
    }
  };

  // Handler: Create Cloze card. `clozeText` already contains the {{c1::...}} deletion.
  // Creates the cards of a new note (one per deletion number). Returns their ids.
  const handleCreateCloze = (
    source: { documentId?: string; extractId?: string },
    clozeText: string,
    sourceText?: string
  ): string[] => {
    const ext = source.extractId ? extractsRef.current.find((e) => e.id === source.extractId) : undefined;
    const docId = source.documentId ?? ext?.documentId;
    const doc = docId ? documentsRef.current.find((d) => d.id === docId) : undefined;
    const now = new Date().toISOString();

    const newCards = cardsForNewNote(
      {
      documentId: doc?.id ?? docId,
      extractId: ext?.id,
      documentTitle: ext?.documentTitle ?? doc?.title ?? 'Note',
      folder: ext?.folder ?? doc?.folder,
      text: clozeText,
      sourceText,
      tags: [...(ext?.tags ?? doc?.tags ?? [])],
      priority: ext?.priority ?? doc?.priority ?? 85,
      createdAt: now,
      updatedAt: now,
      state: 'new',
      fsrs: createInitialFSRSRecord(0), // available for review right away
      },
      () => newId('cloze')
    );
    updateClozes((prev) => [...newCards, ...prev]);
    return newCards.map((c) => c.id);
  };

  // A question/answer card, from a document or an extract. Returns its id.
  const handleCreateQA = (
    source: { documentId?: string; extractId?: string },
    question: string,
    answer: string,
    sourceText?: string
  ): string => {
    const ext = source.extractId ? extractsRef.current.find((e) => e.id === source.extractId) : undefined;
    const docId = source.documentId ?? ext?.documentId;
    const doc = docId ? documentsRef.current.find((d) => d.id === docId) : undefined;
    const now = new Date().toISOString();
    const card: ClozeItem = {
      id: newId('cloze'),
      kind: 'qa',
      documentId: doc?.id ?? docId,
      extractId: ext?.id,
      documentTitle: ext?.documentTitle ?? doc?.title ?? 'Note',
      folder: ext?.folder ?? doc?.folder,
      text: question,
      answer,
      sourceText,
      tags: [...(ext?.tags ?? doc?.tags ?? [])],
      priority: ext?.priority ?? doc?.priority ?? 85,
      createdAt: now,
      updatedAt: now,
      state: 'new',
      fsrs: createInitialFSRSRecord(0),
    };
    updateClozes((prev) => [card, ...prev]);
    return card.id;
  };

  // An image card note: one card per zone number.
  const handleCreateImageCards = (source: { documentId?: string }, note: OcclusionNote): string[] => {
    const doc = source.documentId ? documentsRef.current.find((d) => d.id === source.documentId) : undefined;
    const now = new Date().toISOString();
    const cards = cardsForNewNote(
      {
        kind: 'io',
        documentId: doc?.id,
        documentTitle: doc?.title ?? 'Image',
        folder: doc?.folder,
        text: note.text,
        image: note.image,
        masks: note.masks,
        occlusionMode: note.occlusionMode,
        tags: [...(doc?.tags ?? [])],
        priority: doc?.priority ?? 85,
        createdAt: now,
        updatedAt: now,
        state: 'new',
        fsrs: createInitialFSRSRecord(0),
      },
      () => newId('cloze')
    );
    updateClozes((prev) => [...cards, ...prev]);
    return cards.map((c) => c.id);
  };

  // Incremental writing: an extract goes to the end of a text being written, as a
  // quotation with its source. Can be undone.
  const handleAddToWriting = (documentId: string, extractId: string) => {
    const doc = documentsRef.current.find((d) => d.id === documentId);
    const ext = extractsRef.current.find((e) => e.id === extractId);
    if (!doc || !ext) return;
    const quote = ext.text
      .trim()
      .split('\n')
      .map((line) => (line.trim() ? `> ${line}` : '>'))
      .join('\n');
    const previous = { content: doc.content, updatedAt: doc.updatedAt };
    const content = `${doc.content.replace(/\s*$/, '')}\n\n${quote}\n>\n> — *${ext.documentTitle}*\n\n`;
    updateDocuments((prev) => prev.map((d) => (d.id === documentId ? { ...d, content, updatedAt: new Date().toISOString() } : d)));
    offerUndo(`Ajouté à « ${doc.title} »`, () =>
      updateDocuments((prev) => prev.map((d) => (d.id === documentId ? { ...d, ...previous } : d)))
    );
  };
  const writingTexts = documents.filter((d) => isWriting(d) && d.state !== 'dismissed');

  const handleUpdateQA = (id: string, question: string, answer: string) => {
    const card = clozesRef.current.find((c) => c.id === id);
    if (!card || (card.text === question && card.answer === answer)) return;
    const previous = { text: card.text, answer: card.answer, updatedAt: card.updatedAt };
    const updatedAt = new Date().toISOString();
    updateClozes((prev) => prev.map((c) => (c.id === id ? { ...c, text: question, answer, updatedAt } : c)));
    offerUndo('Question modifiée', () => updateClozes((prev) => prev.map((c) => (c.id === id ? { ...c, ...previous } : c))));
  };

  // ---- Editing extracts and cards -------------------------------------------
  type EditRequest =
    | { kind: 'extract'; id: string }
    | { kind: 'cloze'; id: string }
    | {
        kind: 'new-cloze';
        source: { documentId?: string; extractId?: string };
        text: string;
        /** The sentence as it is in the source, before any rewording in the editor. */
        sourceText?: string;
        context: string;
        info?: string;
        /** Runs once the card is created (e.g. finishing the document after a summary card). */
        afterSave?: () => void;
      }
    | {
        kind: 'new-io';
        source: { documentId?: string };
        image?: string;
        context: string;
      }
    | {
        kind: 'new-qa';
        source: { documentId?: string; extractId?: string };
        /** The selected passage: the answer to start from, and where the card is found again. */
        passage: string;
        context: string;
      };
  const [editRequest, setEditRequest] = useState<EditRequest | null>(null);

  const handleEditItem = (type: ItemType, id: string) => {
    if (type === 'extract') setEditRequest({ kind: 'extract', id });
    else if (type === 'cloze') setEditRequest({ kind: 'cloze', id });
  };

  // Whole sentence selected for a card: open the editor to choose the hidden words.
  const openClozeEditor = (source: { documentId?: string; extractId?: string }, sentence: string) => {
    const ext = source.extractId ? extractsRef.current.find((e) => e.id === source.extractId) : undefined;
    const doc = documentsRef.current.find((d) => d.id === (source.documentId ?? ext?.documentId));
    setEditRequest({
      kind: 'new-cloze',
      source,
      text: sentence,
      sourceText: parseClozes(sentence).map((p) => p.value).join(''),
      context: doc?.title ?? ext?.documentTitle ?? '',
      info: parseClozes(sentence).some((p) => p.type === 'cloze')
        ? 'Vérifiez la carte : vous pouvez masquer d’autres mots (« nouvelle carte » ou « même carte ») ou raccourcir la phrase, puis « Créer la carte » (Ctrl+Entrée).'
        : undefined,
    });
  };

  // An image card: from an image of a document (copied locally first if it is on
  // the web, so it works offline and travels with the sync), or from a file.
  const openOcclusionEditor = async (source: { documentId?: string }, image?: string) => {
    const doc = source.documentId ? documentsRef.current.find((d) => d.id === source.documentId) : undefined;
    let local = image;
    if (image && /^https?:/i.test(image)) {
      try {
        local = await fetchImage(image);
      } catch {
        local = undefined; // the editor asks for a file instead
      }
    }
    setEditRequest({ kind: 'new-io', source, image: local, context: doc?.title ?? '' });
  };

  // A passage selected for a question: it becomes the answer to start from.
  const openQAEditor = (source: { documentId?: string; extractId?: string }, passage: string) => {
    const ext = source.extractId ? extractsRef.current.find((e) => e.id === source.extractId) : undefined;
    const doc = documentsRef.current.find((d) => d.id === (source.documentId ?? ext?.documentId));
    setEditRequest({ kind: 'new-qa', source, passage: passage.trim(), context: doc?.title ?? ext?.documentTitle ?? '' });
  };

  /**
   * Saves an edited extract and applies the same change to the passage in its
   * document and in the extracts it was taken from. Can be undone.
   */
  const handleUpdateExtractText = (id: string, newText: string) => {
    const ext = extractsRef.current.find((e) => e.id === id);
    if (!ext || ext.text === newText) return;
    const oldText = ext.text;
    const now = new Date().toISOString();
    const doc = documentsRef.current.find((d) => d.id === ext.documentId);

    // Document
    const docResult = doc ? replacePassage(doc.content, oldText, newText, ext.sourceStart) : null;
    // Parent extracts (an extract taken from an extract contains the same passage)
    const ancestorUpdates = new Map<string, string>();
    for (let parentId = ext.parentExtractId; parentId; ) {
      const parent = extractsRef.current.find((e) => e.id === parentId);
      if (!parent) break;
      const result = replacePassage(parent.text, oldText, newText, undefined, false);
      if (result) ancestorUpdates.set(parent.id, result.source);
      parentId = parent.parentExtractId;
    }

    const previousDoc = doc ? { content: doc.content, updatedAt: doc.updatedAt } : null;
    const previousExtracts = new Map(
      [ext, ...extractsRef.current.filter((e) => ancestorUpdates.has(e.id))].map((e) => [e.id, { text: e.text, sourceStart: e.sourceStart, updatedAt: e.updatedAt }])
    );
    updateExtracts((prev) =>
      prev.map((e) => {
        if (e.id === id) return { ...e, text: newText, sourceStart: docResult?.start ?? e.sourceStart, updatedAt: now };
        const text = ancestorUpdates.get(e.id);
        return text !== undefined ? { ...e, text, updatedAt: now } : e;
      })
    );
    if (doc && docResult) {
      updateDocuments((prev) => prev.map((d) => (d.id === doc.id ? { ...d, content: docResult.source, updatedAt: now } : d)));
    }

    const message = !doc
      ? 'Extrait modifié'
      : docResult
      ? `Extrait modifié, ainsi que le passage dans « ${doc.title} »`
      : `Extrait modifié. Passage introuvable dans « ${doc.title} » : le document n'a pas changé`;
    offerUndo(message, () => {
      updateExtracts((prev) => prev.map((e) => (previousExtracts.has(e.id) ? { ...e, ...previousExtracts.get(e.id)! } : e)));
      if (doc && docResult && previousDoc) {
        updateDocuments((prev) => prev.map((d) => (d.id === doc.id ? { ...d, ...previousDoc } : d)));
      }
    });
  };

  // Edits the note of a card: all its cards get the text; a new deletion number adds
  // a card, a number that disappears removes its card. Can be undone.
  const handleUpdateClozeText = (id: string, newText: string) => handleUpdateNote(id, { text: newText });

  // Same for any part of a note: its text, or the image and zones of an image card.
  const handleUpdateNote = (id: string, patch: Partial<Pick<ClozeItem, 'text' | 'image' | 'masks' | 'occlusionMode'>>) => {
    const card = clozesRef.current.find((c) => c.id === id);
    const keys = Object.keys(patch) as Array<keyof typeof patch>;
    if (!card || keys.every((k) => JSON.stringify(card[k]) === JSON.stringify(patch[k]))) return;
    const key = noteKeyOf(card);
    const previousNote = new Map(
      clozesRef.current
        .filter((c) => noteKeyOf(c) === key)
        .map((c) => [c.id, { ...Object.fromEntries(keys.map((k) => [k, c[k]])), updatedAt: c.updatedAt }])
    );
    const result = applyNote(clozesRef.current, id, patch, () => newId('cloze'), new Date().toISOString());
    updateClozes(result.cards);
    const changes = [
      result.created.length ? `${result.created.length} carte${result.created.length > 1 ? 's' : ''} ajoutée${result.created.length > 1 ? 's' : ''}` : '',
      result.removed.length ? `${result.removed.length} supprimée${result.removed.length > 1 ? 's' : ''}` : '',
    ].filter(Boolean);
    const createdIds = new Set(result.created.map((c) => c.id));
    offerUndo(changes.length ? `Note modifiée : ${changes.join(', ')}` : 'Carte modifiée', () =>
      updateClozes((prev) =>
        putBack(
          prev.filter((c) => !createdIds.has(c.id)).map((c) => (previousNote.has(c.id) ? { ...c, ...previousNote.get(c.id)! } : c)),
          result.removed
        )
      )
    );
  };

  // ---- Resetting cards ---------------------------------------------------------
  /**
   * Puts cards back to "never reviewed": new schedule and their review history
   * removed (so statistics forget them too). A single card comes back into the queue
   * even if it had been retired; a reset of all cards leaves retired cards retired.
   * Can be undone.
   */
  const resetCards = (ids: string[], options: { reviveRetired: boolean }): number => {
    const targets = new Set(ids);
    const previousCards = new Map(
      clozesRef.current.filter((c) => targets.has(c.id)).map((c) => [c.id, { fsrs: c.fsrs, state: c.state, leech: c.leech }])
    );
    if (previousCards.size === 0) return 0;
    const allLogs = SaudadeStorage.getReviewLogs();
    const removedLogs = allLogs.filter((l) => l.itemType === 'cloze' && targets.has(l.itemId));
    SaudadeStorage.saveReviewLogs(allLogs.filter((l) => !(l.itemType === 'cloze' && targets.has(l.itemId))));
    const now = new Date().toISOString();
    updateClozes((prev) =>
      prev.map((c) =>
        targets.has(c.id)
          ? {
              ...c,
              fsrs: createInitialFSRSRecord(0),
              state: c.state === 'dismissed' && !options.reviveRetired ? 'dismissed' : 'new',
              leech: undefined, // a fresh start
              updatedAt: now,
            }
          : c
      )
    );
    const count = previousCards.size;
    offerUndo(count === 1 ? 'Carte réinitialisée' : `${count} cartes réinitialisées`, () => {
      updateClozes((prev) => prev.map((c) => (previousCards.has(c.id) ? { ...c, ...previousCards.get(c.id)! } : c)));
      // Put the removed history back, keeping reviews made since.
      const merged = [...SaudadeStorage.getReviewLogs(), ...removedLogs].sort((a, b) => a.reviewDate.localeCompare(b.reviewDate));
      SaudadeStorage.saveReviewLogs(merged);
    });
    return count;
  };

  const handleResetAllCards = async (): Promise<boolean> => {
    const snapshotError = await snapshotBefore('avant-reinitialisation-cartes');
    if (snapshotError) {
      setStorageErrors((prev) => [...prev, snapshotError]);
      return false;
    }
    resetCards(clozesRef.current.map((c) => c.id), { reviveRetired: false });
    return true;
  };

  // ---- Viewing extracts and cards (library) ---------------------------------
  const [viewRequest, setViewRequest] = useState<{ type: 'extract' | 'cloze'; id: string } | null>(null);
  // Passage the reader scrolls to and highlights when opened from the viewer.
  const [focusPassage, setFocusPassage] = useState<{ text: string; extractId?: string; cardId?: string; key: number } | null>(null);

  const handleViewItem = (type: 'extract' | 'cloze', id: string) => setViewRequest({ type, id });

  const openInDocument = (type: 'extract' | 'cloze', id: string) => {
    const ext = type === 'extract' ? extracts.find((e) => e.id === id) : undefined;
    const card = type === 'cloze' ? clozes.find((c) => c.id === id) : undefined;
    const source = ext ?? (card?.extractId ? extracts.find((e) => e.id === card.extractId) : undefined);
    const docId = ext?.documentId ?? card?.documentId ?? source?.documentId;
    if (!docId) return;
    // A card is located by its sentence (answers shown), or by its extract.
    const text = source?.text ?? cardPassages(card!)[0] ?? '';
    setViewRequest(null);
    setCurrentDocumentId(docId);
    setActiveTab('reader');
    setFocusPassage({ text, extractId: source?.id, cardId: card?.id, key: Date.now() });
  };

  const renderViewer = () => {
    if (!viewRequest) return null;
    const item =
      viewRequest.type === 'extract'
        ? extracts.find((e) => e.id === viewRequest.id)
        : clozes.find((c) => c.id === viewRequest.id);
    if (!item) return null;
    const docId = 'documentId' in item ? item.documentId : undefined;
    const doc = documents.find((d) => d.id === docId);
    const ext = viewRequest.type === 'extract' ? (item as ExtractItem) : undefined;
    return (
      <ItemViewer
        viewed={viewRequest.type === 'extract' ? { type: 'extract', item: item as ExtractItem } : { type: 'cloze', item: item as ClozeItem }}
        document={doc}
        parentExtract={ext?.parentExtractId ? extracts.find((e) => e.id === ext.parentExtractId) : undefined}
        childCards={ext ? clozes.filter((c) => c.extractId === ext.id) : []}
        childExtracts={ext ? extracts.filter((e) => e.parentExtractId === ext.id) : []}
        inTodayQueue={todayQueue.some((e) => e.item.id === item.id)}
        noteCards={
          viewRequest.type === 'cloze'
            ? clozes.filter((c) => noteKeyOf(c) === noteKeyOf(item as ClozeItem))
            : undefined
        }
        showExtractHighlights={settings.showExtractHighlights}
        onEdit={() => {
          setViewRequest(null);
          handleEditItem(viewRequest.type, viewRequest.id);
        }}
        onOpenInDocument={doc ? () => openInDocument(viewRequest.type, viewRequest.id) : undefined}
        onView={handleViewItem}
        onResetCard={viewRequest.type === 'cloze' ? () => resetCards([viewRequest.id], { reviveRetired: true }) : undefined}
        leech={viewRequest.type === 'cloze' && isLeech(item as ClozeItem, settings.leechThreshold)}
        writingTexts={viewRequest.type === 'extract' ? writingTexts : []}
        onAddToWriting={(docId) => handleAddToWriting(docId, viewRequest.id)}
        onClearLeech={() => clearLeech(viewRequest.id)}
        onClose={() => setViewRequest(null)}
      />
    );
  };

  const renderEditor = () => {
    if (!editRequest) return null;
    const close = () => setEditRequest(null);
    if (editRequest.kind === 'extract') {
      const ext = extracts.find((e) => e.id === editRequest.id);
      if (!ext) return null;
      const doc = documents.find((d) => d.id === ext.documentId);
      const found = doc ? locatePassage(doc.content, ext.text, ext.sourceStart) !== null : false;
      return (
        <ItemEditor
          mode="extract"
          title="Modifier l'extrait"
          context={ext.documentTitle}
          info={
            !doc
              ? undefined
              : found
              ? `Le passage sera aussi modifié dans le document « ${doc.title} ».`
              : `Ce passage n'a pas été retrouvé tel quel dans « ${doc.title} » : seul l'extrait sera modifié.`
          }
          initialText={ext.text}
          onSave={(text) => {
            handleUpdateExtractText(ext.id, text);
            close();
          }}
          onClose={close}
        />
      );
    }
    if (editRequest.kind === 'cloze') {
      const card = clozes.find((c) => c.id === editRequest.id);
      if (!card) return null;
      if (isImageCard(card)) {
        const siblings = clozes.filter((c) => noteKeyOf(c) === noteKeyOf(card)).length;
        return (
          <OcclusionEditor
            title="Modifier la carte image"
            context={siblings > 1 ? `${card.documentTitle ?? ''} · ${siblings} cartes (une par zone)` : card.documentTitle}
            initial={{ image: card.image, masks: card.masks, text: card.text, occlusionMode: card.occlusionMode }}
            onSave={(note) => {
              handleUpdateNote(card.id, { text: note.text, image: note.image, masks: note.masks, occlusionMode: note.occlusionMode });
              close();
            }}
            onClose={close}
          />
        );
      }
      if (isQA(card)) {
        return (
          <ItemEditor
            mode="qa"
            title="Modifier la question"
            context={card.documentTitle}
            initialText={card.text}
            initialAnswer={card.answer}
            onSave={(question, answer) => {
              handleUpdateQA(card.id, question, answer ?? '');
              close();
            }}
            onClose={close}
          />
        );
      }
      return (
        <ItemEditor
          mode="cloze"
          title="Modifier la carte à trou"
          context={card.documentTitle}
          info={(() => {
            const siblings = clozes.filter((c) => noteKeyOf(c) === noteKeyOf(card));
            return siblings.length > 1
              ? `Cette note donne ${siblings.length} cartes (${siblings.map((c) => `c${c.clozeNumber}`).join(', ')}) : le texte leur est commun. Un nouveau numéro ajoute une carte, un numéro retiré supprime la sienne.`
              : undefined;
          })()}
          initialText={card.text}
          initialNumber={card.clozeNumber}
          onSave={(text) => {
            handleUpdateClozeText(card.id, text);
            close();
          }}
          onClose={close}
        />
      );
    }
    if (editRequest.kind === 'new-io') {
      return (
        <OcclusionEditor
          title="Nouvelle carte image"
          context={editRequest.context}
          initial={{ image: editRequest.image }}
          saveLabel="Créer les cartes"
          onSave={(note) => {
            const ids = new Set(handleCreateImageCards(editRequest.source, note));
            close();
            offerUndo(ids.size > 1 ? `${ids.size} cartes image créées` : 'Carte image créée', () =>
              updateClozes((prev) => prev.filter((c) => !ids.has(c.id)))
            );
          }}
          onClose={close}
        />
      );
    }
    if (editRequest.kind === 'new-qa') {
      return (
        <ItemEditor
          mode="qa"
          title="Nouvelle question"
          context={editRequest.context}
          info="Écrivez la question à laquelle le passage sélectionné répond, et raccourcissez la réponse à l’essentiel. Une seule chose à retenir par carte."
          initialText=""
          initialAnswer={editRequest.passage}
          saveLabel="Créer la carte"
          onSave={(question, answer) => {
            const id = handleCreateQA(editRequest.source, question, answer ?? '', editRequest.passage);
            close();
            offerUndo('Question créée', () => updateClozes((prev) => prev.filter((c) => c.id !== id)));
          }}
          onClose={close}
        />
      );
    }
    return (
      <ItemEditor
        mode="cloze"
        title="Nouvelle carte à trou"
        context={editRequest.context}
        info={
          editRequest.info ??
          "Sélectionnez le mot ou l'expression à masquer, puis « Masquer ». Chaque numéro (c1, c2…) donne une carte : « nouvelle carte » pour une question à part, « même carte » pour masquer plusieurs mots ensemble. Vous pouvez aussi raccourcir la phrase."
        }
        initialText={editRequest.text}
        saveLabel="Créer la carte"
        onSave={(text) => {
          const ids = new Set(handleCreateCloze(editRequest.source, text, editRequest.sourceText));
          close();
          if (editRequest.afterSave) {
            editRequest.afterSave();
          } else {
            offerUndo(ids.size > 1 ? `${ids.size} cartes à trou créées` : 'Carte à trou créée', () =>
              updateClozes((prev) => prev.filter((c) => !ids.has(c.id)))
            );
          }
        }}
        onClose={close}
      />
    );
  };

  // Handler: Update FSRS Target Retention
  const handleUpdateTargetRetention = (newRetention: number) => {
    const clamped = Math.min(0.98, Math.max(0.70, Number(newRetention.toFixed(2))));
    const newSettings: AppSettings = { ...settings, targetRetention: clamped };
    setSettings(newSettings);
    SaudadeStorage.saveSettings(newSettings);
  };

  const handleUpdateTopicLimit = (limit: number) => {
    const newSettings: AppSettings = { ...settings, dailyTopicLimit: Math.max(1, Math.min(999, Math.round(limit))) };
    setSettings(newSettings);
    SaudadeStorage.saveSettings(newSettings);
  };

  const handleToggleAutoPostpone = (on: boolean) => {
    const newSettings: AppSettings = { ...settings, autoPostpone: on };
    setSettings(newSettings);
    SaudadeStorage.saveSettings(newSettings);
  };

  /**
   * Overload: the documents and extracts due today beyond the daily limit (the least
   * important) are rescheduled later, lower priorities further. Automatic once a
   * morning when enabled, or on demand from the queue. Can be undone.
   */
  const postponeSurplus = (automatic: boolean) => {
    const current = SaudadeStorage.getSettings();
    const now = new Date();
    const today = localDay(now);
    if (automatic) {
      if (!current.autoPostpone || current.lastAutoPostpone === today) return;
      const marked = { ...current, lastAutoPostpone: today };
      SaudadeStorage.saveSettings(marked);
      setSettings(marked);
    }
    const surplus = topicSurplus(documentsRef.current, extractsRef.current, current.dailyTopicLimit, now);
    if (surplus.length === 0) return;
    const before = new Map(surplus.map((s) => [s.item.id, s.item.fsrs]));
    const later = <T extends DocumentItem | ExtractItem>(item: T): T =>
      before.has(item.id) ? { ...item, fsrs: postponeTopic(item.fsrs, item.priority, now) } : item;
    updateDocuments((prev) => prev.map(later));
    updateExtracts((prev) => prev.map(later));
    const back = <T extends DocumentItem | ExtractItem>(item: T): T =>
      before.has(item.id) ? { ...item, fsrs: before.get(item.id)! } : item;
    offerUndo(
      `${surplus.length} élément${surplus.length > 1 ? 's' : ''} en trop reporté${surplus.length > 1 ? 's' : ''} (les moins prioritaires)`,
      () => {
        updateDocuments((prev) => prev.map(back));
        updateExtracts((prev) => prev.map(back));
      }
    );
  };
  const postponeSurplusRef = useRef(postponeSurplus);
  postponeSurplusRef.current = postponeSurplus;

  const handleUpdateDailyLimit = (limit: number) => {
    const newSettings: AppSettings = { ...settings, dailyReviewLimit: Math.max(1, Math.min(999, Math.round(limit))) };
    setSettings(newSettings);
    SaudadeStorage.saveSettings(newSettings);
  };

  // Handler: Rate a cloze card (FSRS). Returns the new scheduling record.
  const handleRateCard = (id: string, rating: ReviewRating): FSRSRecord | undefined => {
    const target = clozesRef.current.find((c) => c.id === id);
    if (!target) return undefined;
    const now = new Date();
    const fsrs = applyCardReview(target.fsrs, rating, now, settings.targetRetention);
    let state: ItemState = fsrs.phase === 'review' ? 'review' : 'learning';
    // A lapse that makes the card a leech: flagged (and set aside if chosen), and said.
    const leech = fsrs.lapses > target.fsrs.lapses && lapseMakesLeech(fsrs.lapses, settings.leechThreshold);
    if (leech && settings.leechSuspend) state = 'dismissed';
    updateClozes((prev) =>
      prev.map((c) => (c.id === id ? { ...c, fsrs, state, ...(leech ? { leech: true } : {}), updatedAt: now.toISOString() } : c))
    );
    if (leech) setLeechNotice({ id, lapses: fsrs.lapses, suspended: settings.leechSuspend });
    SaudadeStorage.appendReviewLog({
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
      retention: settings.targetRetention,
    });
    return fsrs;
  };

  // Handler: done reading a document or extract for now ("Suivant"): reschedule it
  // with an interval that grows according to its priority. Returns the interval in days.
  // Done reading a document or extract for now ("Lu" / "Suivant"). Only an item due
  // today is rescheduled: one already scheduled for later keeps its date, so opening
  // it again can't push it further away by accident.
  const handleTopicNext = (
    type: 'document' | 'extract',
    id: string
  ): { rescheduled: boolean; days: number } | undefined => {
    const now = new Date();
    const list: Array<DocumentItem | ExtractItem> = type === 'document' ? documentsRef.current : extractsRef.current;
    const target = list.find((i) => i.id === id);
    if (!target) return undefined;
    if (!isDueToday(target.fsrs, now)) {
      const days = Math.max(0, (new Date(target.fsrs.nextReviewDate).getTime() - now.getTime()) / 86400000);
      return { rescheduled: false, days };
    }
    const fsrs = applyTopicReview(target.fsrs, target.priority, now);
    const patch = { fsrs, state: 'review' as ItemState, updatedAt: now.toISOString() };
    if (type === 'document') {
      updateDocuments((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    } else {
      updateExtracts((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    }
    SaudadeStorage.appendReviewLog({
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
    return { rescheduled: true, days: fsrs.interval };
  };

  // "Pas fini": the document comes back tomorrow, at the same place. It doesn't count
  // as a reading, so its interval doesn't grow.
  const handleNotFinished = (docId: string) => {
    const doc = documentsRef.current.find((d) => d.id === docId);
    if (!doc) return;
    const tomorrow = new Date();
    tomorrow.setHours(24, 0, 0, 0);
    const previous = doc.fsrs;
    updateDocuments((prev) =>
      prev.map((d) => (d.id === docId ? { ...d, fsrs: { ...d.fsrs, nextReviewDate: tomorrow.toISOString() } } : d))
    );
    openNextDueDocument(docId);
    offerUndo(`« ${doc.title} » : reprise demain`, () =>
      updateDocuments((prev) => prev.map((d) => (d.id === docId ? { ...d, fsrs: previous } : d)))
    );
  };

  const handleLowerPriority = (docId: string) => {
    updateDocuments((prev) =>
      prev.map((d) => (d.id === docId ? { ...d, priority: Math.max(0, d.priority - 20), updatedAt: new Date().toISOString() } : d))
    );
  };

  // Finishing a text with nothing extracted: a summary card, then the text is done.
  const handleWriteSummary = (docId: string) => {
    const doc = documentsRef.current.find((d) => d.id === docId);
    if (!doc) return;
    setEditRequest({
      kind: 'new-cloze',
      source: { documentId: docId },
      text: `L'idée principale de « ${doc.title} » : `,
      context: doc.title,
      info: "Résumez l'essentiel du texte en une ou deux phrases, puis masquez les mots clés (« Masquer la sélection »). Le texte sera ensuite terminé.",
      afterSave: () => {
        handleDismissItem('document', docId);
        openNextDueDocument(docId);
      },
    });
  };

  // Opens the highest-priority document due today (other than `excludeId`),
  // or goes back to the queue when there is nothing left to read.
  const openNextDueDocument = (excludeId: string) => {
    const next = documentsRef.current
      .filter((d) => d.id !== excludeId && d.state !== 'dismissed' && isDueToday(d.fsrs))
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

  // A new version downloaded: offer to restart (or it installs when the app quits).
  const update = useUpdates();
  const [updateDismissed, setUpdateDismissed] = useState(false);

  // A card just became a leech: a notice offering to reword it.
  const [leechNotice, setLeechNotice] = useState<{ id: string; lapses: number; suspended: boolean } | null>(null);
  const clearLeech = (id: string) =>
    updateClozes((prev) => prev.map((c) => (c.id === id ? { ...c, leech: false, updatedAt: new Date().toISOString() } : c)));
  const handleUpdateLeechSettings = (patch: Partial<Pick<AppSettings, 'leechThreshold' | 'leechSuspend'>>) => {
    const newSettings: AppSettings = { ...settings, ...patch };
    setSettings(newSettings);
    SaudadeStorage.saveSettings(newSettings);
  };

  // Undo for deletions and retirements: a short notice with an "Annuler" button.
  const [undoAction, setUndoAction] = useState<{ message: string; undo: () => void } | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  const offerUndo = (message: string, undo: () => void) => {
    window.clearTimeout(undoTimer.current);
    setUndoAction({ message, undo });
    undoTimer.current = window.setTimeout(() => setUndoAction(null), 10000);
  };
  const runUndo = () => {
    if (!undoAction) return;
    window.clearTimeout(undoTimer.current);
    undoAction.undo();
    setUndoAction(null);
  };

  type Removed<T> = Array<[number, T]>;
  const takeOut = <T,>(list: T[], match: (item: T) => boolean): Removed<T> =>
    list.flatMap((item, index) => (match(item) ? [[index, item] as [number, T]] : []));
  // Puts removed items back at their former position, keeping later changes.
  const putBack = <T extends { id: string }>(list: T[], removed: Removed<T>): T[] => {
    const next = [...list];
    for (const [index, item] of removed) {
      if (!next.some((i) => i.id === item.id)) next.splice(Math.min(index, next.length), 0, item);
    }
    return next;
  };

  const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

  // Handler: Delete Document (with cascade delete of associated extracts and clozes)
  const handleDeleteDocument = (docId: string) => {
    const doc = documentsRef.current.find((d) => d.id === docId);
    if (!doc) return;
    const removedDocs = takeOut(documentsRef.current, (d) => d.id === docId);
    const removedExts = takeOut(extractsRef.current, (e) => e.documentId === docId);
    const removedClozes = takeOut(clozesRef.current, (c) => c.documentId === docId);
    updateDocuments((prev) => prev.filter((d) => d.id !== docId));
    updateExtracts((prev) => prev.filter((e) => e.documentId !== docId));
    updateClozes((prev) => prev.filter((c) => c.documentId !== docId));

    if (currentDocumentId === docId) {
      setCurrentDocumentId(documentsRef.current[0]?.id ?? '');
    }
    const extras = [
      removedExts.length ? plural(removedExts.length, 'extrait') : '',
      removedClozes.length ? plural(removedClozes.length, 'carte') : '',
    ].filter(Boolean);
    offerUndo(`« ${doc.title} » supprimé${extras.length ? ` avec ${extras.join(' et ')}` : ''}`, () => {
      updateDocuments((prev) => putBack(prev, removedDocs));
      updateExtracts((prev) => putBack(prev, removedExts));
      updateClozes((prev) => putBack(prev, removedClozes));
    });
  };

  // Handler: Update Document (Content, Title, Author, Tags, Priority, Format, etc.)
  const handleUpdateDocument = (updatedDoc: DocumentItem) => {
    const oldDoc = documentsRef.current.find((d) => d.id === updatedDoc.id);
    updateDocuments((prev) => prev.map((d) => (d.id === updatedDoc.id ? updatedDoc : d)));

    // Synchroniser le titre sur les extraits et clozes associés si le titre a changé
    if (oldDoc && oldDoc.title !== updatedDoc.title) {
      updateExtracts((prev) =>
        prev.map((e) => (e.documentId === updatedDoc.id ? { ...e, documentTitle: updatedDoc.title } : e))
      );
      updateClozes((prev) =>
        prev.map((c) => (c.documentId === updatedDoc.id ? { ...c, documentTitle: updatedDoc.title } : c))
      );
    }
  };

  // Handler: Delete Extract
  const handleDeleteExtract = (extractId: string) => {
    const removed = takeOut(extractsRef.current, (e) => e.id === extractId);
    if (removed.length === 0) return;
    updateExtracts((prev) => prev.filter((e) => e.id !== extractId));
    offerUndo('Extrait supprimé', () => updateExtracts((prev) => putBack(prev, removed)));
  };

  // Handler: Delete Cloze
  const handleDeleteCloze = (clozeId: string) => {
    const removed = takeOut(clozesRef.current, (c) => c.id === clozeId);
    if (removed.length === 0) return;
    updateClozes((prev) => prev.filter((c) => c.id !== clozeId));
    offerUndo('Carte supprimée', () => updateClozes((prev) => putBack(prev, removed)));
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

  // Handler: Dismiss Item ("Terminer": leaves the queue, can be undone)
  const handleDismissItem = (type: ItemType, id: string) => {
    const setState = (state: (prev: ItemState) => ItemState) => {
      if (type === 'document') {
        updateDocuments((prev) => prev.map((d) => (d.id === id ? { ...d, state: state(d.state) } : d)));
      } else if (type === 'extract') {
        updateExtracts((prev) => prev.map((e) => (e.id === id ? { ...e, state: state(e.state) } : e)));
      } else {
        updateClozes((prev) => prev.map((c) => (c.id === id ? { ...c, state: state(c.state) } : c)));
      }
    };
    const list: Array<{ id: string; state: ItemState }> =
      type === 'document' ? documentsRef.current : type === 'extract' ? extractsRef.current : clozesRef.current;
    const previous = list.find((i) => i.id === id)?.state;
    if (!previous || previous === 'dismissed') return;
    setState(() => 'dismissed');
    const label = type === 'document' ? 'Texte terminé' : type === 'extract' ? 'Extrait terminé' : 'Carte retirée';
    offerUndo(`${label} : retiré de la file`, () => setState(() => previous));
  };

  // Ctrl+Z undoes the last deletion while its notice is visible.
  useEffect(() => {
    if (!undoAction) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        runUndo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Handler: Update Reading Progress (called debounced by the reader)
  const handleUpdateProgress = useCallback((docId: string, progress: number, offset: number) => {
    updateDocuments((prev) =>
      prev.map((d) => (d.id === docId ? { ...d, readingProgress: progress, lastReadOffset: offset } : d))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Export JSON Backup
  const handleExportBackup = () => {
    const jsonStr = SaudadeStorage.exportBackup();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saudade-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export Markdown Mirror (format Obsidian)
  const handleExportMarkdownMirror = () => {
    let combinedMd = `# Miroir de Voûte Saudade (Lecture Incrémentale)\nExporté le : ${new Date().toLocaleString('fr-FR')}\n\n`;

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
    a.download = `saudade-markdown-mirror-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reloadFromStorage = () => {
    const docs = SaudadeStorage.getDocuments();
    const exts = SaudadeStorage.getExtracts();
    const clzs = SaudadeStorage.getClozes();
    documentsRef.current = docs;
    extractsRef.current = exts;
    clozesRef.current = clzs;
    setDocuments(docs);
    setExtracts(exts);
    setClozes(clzs);
    const restoredSettings = SaudadeStorage.getSettings();
    setSettings(restoredSettings);
    applyTheme(restoredSettings.theme);
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
    const result = SaudadeStorage.importBackup(text);
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
    SaudadeStorage.resetToSamples();
    reloadFromStorage();
    setActiveTab('queue');
    return true;
  };

  return (
    <div className="min-h-screen bg-[var(--bg-faf7f2)] text-[var(--fg-28231d)] flex flex-col selection:bg-[var(--bg-ebe2d3)] selection:text-[var(--fg-28231d)]">
      {/* 3-Zone Top Navigation Contract */}
      <TopNav
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setReviewClozeId(undefined);
        }}
        dueCount={todayQueue.length}
        onOpenImport={() => setIsImportOpen(true)}
        theme={settings.theme}
        onChangeTheme={(theme) => {
          const newSettings: AppSettings = { ...settings, theme };
          setSettings(newSettings);
          SaudadeStorage.saveSettings(newSettings);
          applyTheme(theme);
        }}
      />

      {storageErrors.length > 0 && (
        <div role="alert" className="bg-[var(--bg-fdf2f0)] border-b border-[var(--bd-f2d6d3)] text-[var(--fg-8f352b)] text-xs">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-start justify-between gap-4">
            <ul className="space-y-1">
              {storageErrors.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setStorageErrors([])}
              className="shrink-0 px-2 py-0.5 rounded-md hover:bg-[var(--bg-f2d6d3)] font-medium"
            >
              Masquer
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 pb-20 md:pb-0">
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
            queue={todayQueue}
            leechThreshold={settings.leechThreshold}
            overload={overload}
            autoPostpone={settings.autoPostpone}
            onPostponeSurplus={() => postponeSurplus(false)}
            nextDueDate={nextDueDate}
            onEditItem={handleEditItem}
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
              onFinishReading={(docId) => {
                handleTopicNext('document', docId);
                openNextDueDocument(docId);
              }}
              onOpenClozeEditor={(docId, sentence) => openClozeEditor({ documentId: docId }, sentence)}
              onOpenQAEditor={(docId, passage) => openQAEditor({ documentId: docId }, passage)}
              onOpenOcclusionEditor={(docId, image) => !isMobileApp && void openOcclusionEditor({ documentId: docId }, image)}
              onEditItem={handleEditItem}
              focusPassage={focusPassage}
              onViewItem={handleViewItem}
              onNotFinished={handleNotFinished}
              onLowerPriority={handleLowerPriority}
              onWriteSummary={handleWriteSummary}
              documentCards={clozes.filter((c) => c.documentId === currentDocument.id && c.state !== 'dismissed')}
              showExtractHighlights={settings.showExtractHighlights}
              onToggleExtractHighlights={() => {
                const newSettings: AppSettings = { ...settings, showExtractHighlights: !settings.showExtractHighlights };
                setSettings(newSettings);
                SaudadeStorage.saveSettings(newSettings);
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
            onEditItem={handleEditItem}
            onOpenClozeEditor={(extractId, sentence) => openClozeEditor({ extractId }, sentence)}
            onOpenQAEditor={(extractId, passage) => openQAEditor({ extractId }, passage)}
            onRetireExtract={(id) => handleDismissItem('extract', id)}
            onCreateExtractFromExtract={(extractId, text) => {
              const parent = extractsRef.current.find((e) => e.id === extractId);
              if (parent) handleCreateExtract({ documentId: parent.documentId, parentExtractId: extractId }, text);
            }}
            dailyLimit={settings.dailyReviewLimit}
            documents={documents}
            topicLimit={settings.dailyTopicLimit}
            shuffle={settings.shuffleQueue}
            leechThreshold={settings.leechThreshold}
            writingTexts={writingTexts}
            onAddToWriting={handleAddToWriting}
            reviewedTodayIds={reviewedTodayIds}
            showExtractHighlights={settings.showExtractHighlights}
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
            onEditItem={handleEditItem}
            onViewItem={handleViewItem}
            leechThreshold={settings.leechThreshold}
            onNewImageCard={isMobileApp ? undefined : () => void openOcclusionEditor({})}
          />
        )}

        {activeTab === 'stats' && (
          <StatsView
            stats={stats}
            documents={documents}
            extracts={extracts}
            clozes={clozes}
            targetRetention={settings.targetRetention}
            leeches={clozes.filter((c) => c.state !== 'dismissed' && isLeech(c, settings.leechThreshold)).length}
            today={{
              documents: todayQueue.filter((e) => e.type === 'document').length,
              extracts: todayQueue.filter((e) => e.type === 'extract').length,
              cards: todayQueue.filter((e) => e.type === 'cloze').length,
            }}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            cardCount={clozes.length}
            targetRetention={settings.targetRetention}
            onUpdateTargetRetention={handleUpdateTargetRetention}
            dailyReviewLimit={settings.dailyReviewLimit}
            onUpdateDailyLimit={handleUpdateDailyLimit}
            leechThreshold={settings.leechThreshold}
            leechSuspend={settings.leechSuspend}
            shuffleQueue={settings.shuffleQueue}
            onToggleShuffle={(on) => {
              const newSettings: AppSettings = { ...settings, shuffleQueue: on };
              setSettings(newSettings);
              SaudadeStorage.saveSettings(newSettings);
            }}
            onUpdateLeechSettings={handleUpdateLeechSettings}
            dailyTopicLimit={settings.dailyTopicLimit}
            onUpdateTopicLimit={handleUpdateTopicLimit}
            autoPostpone={settings.autoPostpone}
            onToggleAutoPostpone={handleToggleAutoPostpone}
            onExportBackup={handleExportBackup}
            onExportMarkdownMirror={handleExportMarkdownMirror}
            onResetDemo={handleResetDemo}
            onRestoreBackup={handleRestoreBackup}
            onResetAllCards={handleResetAllCards}
            onOpenDataFolder={isDesktop && !isMobileApp ? openDataFolder : undefined}
            dataLocation={dataLocation}
          />
        )}
      </main>

      {undoAction && (
        <div
          role="status"
          className="fixed bottom-6 left-6 z-[60] flex items-center gap-3 pl-4 pr-2 py-2 bg-[var(--bg-28231d)] text-[var(--fg-faf7f2)] text-xs font-medium rounded-xl shadow-lg border border-[var(--bd-3e3831)]"
        >
          <span className="max-w-xs truncate">{undoAction.message}</span>
          <button
            type="button"
            onClick={runUndo}
            className="px-2.5 py-1 rounded-lg font-semibold text-[var(--fg-e6c280)] hover:bg-[var(--bg-3e3831)] cursor-pointer"
            title="Annuler (Ctrl+Z)"
          >
            Annuler
          </button>
        </div>
      )}

      {update?.status === 'ready' && !updateDismissed && (
        <div
          role="status"
          className="fixed top-20 right-6 z-[60] flex items-center gap-3 pl-4 pr-2 py-2 bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-xl shadow-lg text-xs text-[var(--fg-4a4137)]"
        >
          <span>Saudade {update.version} est prête.</span>
          <button
            type="button"
            onClick={() => installUpdate()}
            className="px-3 py-1.5 rounded-lg font-semibold text-white bg-[var(--bg-8c5e32)] hover:bg-[var(--bg-774d27)] cursor-pointer"
          >
            Redémarrer
          </button>
          <button
            type="button"
            onClick={() => setUpdateDismissed(true)}
            className="px-2 py-1.5 rounded-lg text-[var(--fg-695f54)] hover:bg-[var(--bg-f3efe8)] cursor-pointer"
            title="Elle s’installera à la fermeture de Saudade"
          >
            Plus tard
          </button>
        </div>
      )}

      {leechNotice && (() => {
        const card = clozes.find((c) => c.id === leechNotice.id);
        if (!card) return null;
        return (
          <div
            role="alert"
            aria-label="Sangsue"
            className="fixed bottom-6 right-6 z-[60] w-80 p-4 bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-xl shadow-lg text-xs text-[var(--fg-4a4137)]"
          >
            <p className="font-semibold text-[var(--fg-a84236)]">Sangsue : carte oubliée {leechNotice.lapses} fois</p>
            <p className="mt-1">
              {leechNotice.suspended ? 'Elle est retirée de la file. ' : ''}
              Elle coûte plus de révisions qu’elle n’en rapporte : reformulez-la, découpez-la en cartes plus simples, ou remettez-la à zéro.
            </p>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setLeechNotice(null)}
                className="px-2.5 py-1.5 rounded-lg text-[var(--fg-695f54)] hover:bg-[var(--bg-f3efe8)] cursor-pointer"
              >
                Plus tard
              </button>
              <button
                type="button"
                onClick={() => {
                  setLeechNotice(null);
                  handleEditItem('cloze', card.id);
                }}
                className="px-3 py-1.5 rounded-lg font-semibold text-white bg-[var(--bg-8c5e32)] hover:bg-[var(--bg-774d27)] cursor-pointer"
              >
                Reformuler la carte
              </button>
            </div>
          </div>
        );
      })()}

      {renderViewer()}
      {renderEditor()}

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
          SaudadeStorage.saveFolders([...SaudadeStorage.getFolders(), ...newDocs.map((d) => d.folder || 'Général')]);
          setCurrentDocumentId(newDocs[0].id);
          setActiveTab('reader');
        }}
      />
    </div>
  );
}
