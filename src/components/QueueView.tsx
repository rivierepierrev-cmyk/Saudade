import React, { useState } from 'react';
import { DocumentItem, ExtractItem, ClozeItem, ItemType } from '../types/foliole';
import { formatInterval } from '../lib/fsrs';
import {
  BookOpen,
  FileText,
  Sparkles,
  Search,
  CheckCircle2,
  Layers,
  Trash2,
  Folder,
} from 'lucide-react';

export interface UnifiedQueueItem {
  id: string;
  type: ItemType;
  title: string;
  preview: string;
  sourceDocTitle?: string;
  folder?: string;
  priority: number;
  tags: string[];
  nextReviewDate: string;
  stability: number;
  difficulty: number;
  reps: number;
  readingProgress?: number;
  originalItem: DocumentItem | ExtractItem | ClozeItem;
}

interface QueueViewProps {
  documents: DocumentItem[];
  extracts: ExtractItem[];
  clozes: ClozeItem[];
  onSelectDocument: (doc: DocumentItem) => void;
  onStartReview: (clozeId?: string) => void;
  onUpdatePriority?: (type: ItemType, id: string, newPriority: number) => void;
  onPostponeItem?: (type: ItemType, id: string, days: number) => void;
  onDismissItem?: (type: ItemType, id: string) => void;
  onDeleteItem?: (type: ItemType, id: string) => void;
  onOpenImport: () => void;
}

export const QueueView: React.FC<QueueViewProps> = ({
  documents,
  extracts,
  clozes,
  onSelectDocument,
  onStartReview,
  onDeleteItem,
  onOpenImport,
}) => {
  const [filterType, setFilterType] = useState<'all' | 'due' | 'document' | 'extract' | 'cloze'>('all');
  const [selectedFolder, setSelectedFolder] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const docMap = new Map(documents.map((d) => [d.id, d]));

  const queueItems: UnifiedQueueItem[] = [];

  documents.forEach((doc) => {
    if (doc.state !== 'dismissed') {
      queueItems.push({
        id: doc.id,
        type: 'document',
        title: doc.title,
        preview: doc.content.slice(0, 180).replace(/[#*`_]/g, '') + '...',
        folder: doc.folder || 'Général',
        priority: doc.priority,
        tags: doc.tags,
        nextReviewDate: doc.fsrs.nextReviewDate,
        stability: doc.fsrs.stability,
        difficulty: doc.fsrs.difficulty,
        reps: doc.fsrs.reps,
        readingProgress: doc.readingProgress,
        originalItem: doc,
      });
    }
  });

  extracts.forEach((ext) => {
    if (ext.state !== 'dismissed') {
      const parentDoc = docMap.get(ext.documentId);
      queueItems.push({
        id: ext.id,
        type: 'extract',
        title: ext.documentTitle,
        preview: ext.text,
        sourceDocTitle: ext.documentTitle,
        folder: ext.folder || parentDoc?.folder || 'Général',
        priority: ext.priority,
        tags: ext.tags,
        nextReviewDate: ext.fsrs.nextReviewDate,
        stability: ext.fsrs.stability,
        difficulty: ext.fsrs.difficulty,
        reps: ext.fsrs.reps,
        originalItem: ext,
      });
    }
  });

  clozes.forEach((clz) => {
    if (clz.state !== 'dismissed') {
      const parentDoc = clz.documentId ? docMap.get(clz.documentId) : undefined;
      queueItems.push({
        id: clz.id,
        type: 'cloze',
        title: clz.documentTitle || 'Carte de rappel actif Cloze',
        preview: clz.text.replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, '[$1]'),
        sourceDocTitle: clz.documentTitle,
        folder: clz.folder || parentDoc?.folder || 'Général',
        priority: clz.priority,
        tags: clz.tags,
        nextReviewDate: clz.fsrs.nextReviewDate,
        stability: clz.fsrs.stability,
        difficulty: clz.fsrs.difficulty,
        reps: clz.fsrs.reps,
        originalItem: clz,
      });
    }
  });

  const now = new Date();
  now.setHours(23, 59, 59, 999);

  const filteredItems = queueItems
    .filter((item) => {
      if (filterType === 'due') {
        return new Date(item.nextReviewDate) <= now;
      }
      if (filterType !== 'all' && item.type !== filterType) {
        return false;
      }
      if (
        selectedFolder !== 'all' &&
        item.folder !== selectedFolder &&
        !(item.folder || '').startsWith(`${selectedFolder}/`)
      ) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = item.title.toLowerCase().includes(query);
        const matchesPreview = item.preview.toLowerCase().includes(query);
        const matchesTags = item.tags.some((t) => t.toLowerCase().includes(query));
        return matchesTitle || matchesPreview || matchesTags;
      }
      return true;
    })
    .sort((a, b) => {
      const aDue = new Date(a.nextReviewDate) <= now;
      const bDue = new Date(b.nextReviewDate) <= now;

      if (aDue && !bDue) return -1;
      if (!aDue && bDue) return 1;
      return b.priority - a.priority;
    });

  const dueCount = queueItems.filter((i) => new Date(i.nextReviewDate) <= now).length;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* En-tête */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8 pb-6 border-b border-[#E8E2D5]">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#28231D]">
            File de lecture incrémentale
          </h1>
        </div>

        {/* Actions rapides */}
        <div className="flex items-center gap-3">
          {dueCount > 0 ? (
            <button
              onClick={() => onStartReview()}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[#8C5E32] hover:bg-[#774D27] rounded-lg shadow-xs transition-all"
            >
              <Sparkles className="w-4 h-4" />
              <span>Révision du jour ({dueCount})</span>
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs text-[#5F8550]">
                <CheckCircle2 className="w-4 h-4" />
                <span>À jour</span>
              </div>
              <button
                onClick={() => onStartReview()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#695F54] hover:text-[#28231D] bg-white hover:bg-[#F3EFE8] border border-[#E8E2D5] rounded-lg transition-colors cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#8C5E32]" />
                <span>Révision du jour</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Barre de filtres et recherche */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 mb-6">
        {/* Contrôle segmenté de filtrage en blanc et beige */}
        <div className="flex items-center gap-1 p-1 bg-[#F3EFE8] border border-[#E8E2D5] rounded-lg overflow-x-auto">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              filterType === 'all'
                ? 'bg-white text-[#28231D] shadow-xs font-semibold'
                : 'text-[#695F54] hover:text-[#28231D]'
            }`}
          >
            Tout le flux ({queueItems.length})
          </button>
          <button
            onClick={() => setFilterType('due')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              filterType === 'due'
                ? 'bg-white text-[#28231D] shadow-xs font-semibold'
                : 'text-[#695F54] hover:text-[#28231D]'
            }`}
          >
            Du jour ({dueCount})
          </button>
          <button
            onClick={() => setFilterType('document')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              filterType === 'document'
                ? 'bg-white text-[#28231D] shadow-xs font-semibold'
                : 'text-[#695F54] hover:text-[#28231D]'
            }`}
          >
            Documents ({documents.length})
          </button>
          <button
            onClick={() => setFilterType('extract')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              filterType === 'extract'
                ? 'bg-white text-[#28231D] shadow-xs font-semibold'
                : 'text-[#695F54] hover:text-[#28231D]'
            }`}
          >
            Extraits ({extracts.length})
          </button>
          <button
            onClick={() => setFilterType('cloze')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              filterType === 'cloze'
                ? 'bg-white text-[#28231D] shadow-xs font-semibold'
                : 'text-[#695F54] hover:text-[#28231D]'
            }`}
          >
            Cartes Cloze ({clozes.length})
          </button>
        </div>

        {/* Filtre par dossier d'arborescence */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F3EFE8] border border-[#E8E2D5] rounded-lg text-xs text-[#4A3E31]">
            <Folder className="w-3.5 h-3.5 text-[#8C5E32] shrink-0" />
            <select
              value={selectedFolder}
              onChange={(e) => setSelectedFolder(e.target.value)}
              className="bg-transparent text-xs font-medium text-[#28231D] focus:outline-none cursor-pointer"
            >
              <option value="all">Tous les dossiers</option>
              {Array.from(new Set(documents.map((d) => d.folder || 'Général')))
                .sort()
                .map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
            </select>
          </div>
        </div>

        {/* Champ de recherche */}
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-[#9E9385] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Rechercher des éléments, tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-[#E8E2D5] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#8C5E32] text-[#28231D] placeholder:text-[#9E9385]"
          />
        </div>
      </div>

      {/* Liste des cartes en blanc avec bordures beige */}
      {filteredItems.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-[#DDD6C8] rounded-xl bg-white/60">
          <Layers className="w-10 h-10 mx-auto text-[#9E9385] mb-3" />
          <h3 className="text-base font-semibold text-[#28231D]">
            Aucun élément dans cette vue
          </h3>
          <p className="text-xs text-[#695F54] max-w-sm mx-auto mt-1 mb-4">
            Importez un article ou une note markdown pour débuter la lecture incrémentale et extraire des connaissances.
          </p>
          <button
            onClick={onOpenImport}
            className="px-4 py-2 text-xs font-semibold text-[#FAF7F2] bg-[#3B3026] hover:bg-[#28211A] rounded-lg shadow-xs"
          >
            Importer un document
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const isDue = new Date(item.nextReviewDate) <= now;
            const isDoc = item.type === 'document';
            const isExtract = item.type === 'extract';
            const isCloze = item.type === 'cloze';

            return (
              <div
                key={`${item.type}-${item.id}`}
                className={`p-4 bg-white border rounded-xl transition-all duration-150 ${
                  isDue
                    ? 'border-[#C29E6B] shadow-xs'
                    : 'border-[#E8E2D5] hover:border-[#D0C6B3]'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  {/* Zone de contenu gauche */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs text-[#695F54] mb-1.5 flex-wrap">
                      <span className="font-semibold text-[#3B3026] uppercase tracking-wider text-[10px]">
                        {isDoc ? 'Document' : isExtract ? 'Extrait' : 'Carte Cloze'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-[10px] bg-[#FAF7F2] px-1.5 py-0.5 rounded border border-[#E8E2D5]">
                        📁 {item.folder || 'Général'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">Prio : {item.priority}%</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">Stabilité : {item.stability} j</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">Répétitions : {item.reps}</span>
                      {isDue ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-[#8C5E32]">À réviser</span>
                        </>
                      ) : (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>
                            Dans {formatInterval((new Date(item.nextReviewDate).getTime() - now.getTime()) / 86400000)}
                          </span>
                        </>
                      )}
                    </div>

                    <h2
                      onClick={() => {
                        if (isDoc) {
                          onSelectDocument(item.originalItem as DocumentItem);
                        } else {
                          onStartReview(item.id);
                        }
                      }}
                      className="text-base font-semibold text-[#28231D] hover:text-[#8C5E32] cursor-pointer transition-colors"
                    >
                      {item.title}
                    </h2>

                    {isExtract && (
                      <div className="flex items-center gap-1.5 mt-1 text-xs text-[#8C8072]">
                        <span>Issu du document :</span>
                        <button
                          type="button"
                          onClick={() => {
                            const doc = documents.find((d) => d.id === (item.originalItem as ExtractItem).documentId);
                            if (doc) onSelectDocument(doc);
                          }}
                          className="text-[#8C5E32] hover:underline font-medium text-left cursor-pointer inline-flex items-center gap-1"
                          title="Ouvrir le document entier dans le lecteur"
                        >
                          <span>{item.title}</span>
                          <BookOpen className="w-3 h-3" />
                        </button>
                      </div>
                    )}

                    <p className="mt-1 text-xs sm:text-sm text-[#4A4137] line-clamp-2 leading-relaxed">
                      {item.preview}
                    </p>

                    <div className="flex items-center gap-3 mt-3 text-xs text-[#8C8072] flex-wrap">
                      {item.tags.length > 0 && <span>{item.tags.join(' / ')}</span>}
                      {isDoc && typeof item.readingProgress === 'number' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">Progression : {item.readingProgress}%</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Actions à droite */}
                  <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0 border-t sm:border-t-0 pt-3 sm:pt-0 border-[#F3EFE8]">
                    {isDoc ? (
                      <button
                        onClick={() => onSelectDocument(item.originalItem as DocumentItem)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#3B3026] hover:bg-[#28211A] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>Lire</span>
                      </button>
                    ) : isCloze ? (
                      <button
                        onClick={() => onStartReview(item.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#8C5E32] hover:bg-[#774D27] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Réviser</span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => onStartReview(item.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#8C5E32] hover:bg-[#774D27] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                          title="Réviser cet extrait dans le module de mémorisation FSRS"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Réviser</span>
                        </button>
                        <button
                          onClick={() => {
                            const doc = documents.find((d) => d.id === (item.originalItem as ExtractItem).documentId);
                            if (doc) onSelectDocument(doc);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#3B3026] bg-[#F3EFE8] hover:bg-[#EAE4D9] border border-[#E8E2D5] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                          title="Ouvrir le document entier dans le lecteur"
                        >
                          <BookOpen className="w-3.5 h-3.5 text-[#8C5E32]" />
                          <span className="hidden sm:inline">Document</span>
                        </button>
                      </div>
                    )}

                    {onDeleteItem && (
                      <div className="flex items-center">
                        {pendingDeleteId === item.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                onDeleteItem(item.type, item.id);
                                setPendingDeleteId(null);
                              }}
                              className="px-2 py-1 text-[10px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded cursor-pointer"
                              title="Confirmer la suppression"
                            >
                              Confirmer
                            </button>
                            <button
                              onClick={() => setPendingDeleteId(null)}
                              className="px-2 py-1 text-[10px] text-[#695F54] hover:text-[#28231D] rounded cursor-pointer"
                            >
                              Annuler
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setPendingDeleteId(item.id)}
                            title="Supprimer définitivement cet objet"
                            className="p-1.5 text-[#8C8072] hover:text-red-600 rounded transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
