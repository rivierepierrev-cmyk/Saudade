import React, { useState } from 'react';
import { DocumentItem, ExtractItem, ClozeItem, ItemType } from '../types/saudade';
import { formatInterval } from '../lib/fsrs';
import { matchesQuery } from '../lib/search';
import { renderTextWithMath } from '../lib/math';
import { cardKindLabel, cardPreview } from '../lib/cards';
import { safeHtml } from '../lib/markdown';
import type { QueueEntry } from '../lib/queue';
import { projectMarkdown } from '../lib/sourceSync';
import {
  BookOpen,
  FileText,
  Sparkles,
  Search,
  CheckCircle2,
  Layers,
  Trash2,
  Folder,
  Pencil,
} from 'lucide-react';

const TYPE_LABEL: Record<ItemType, string> = { document: 'Document', extract: 'Extrait', cloze: 'Carte à trou' };
const ICON_BUTTON =
  'p-1.5 rounded-md text-[var(--fg-8c8072)] hover:text-[var(--fg-28231d)] hover:bg-[var(--bg-f3efe8)] transition-colors cursor-pointer';

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
  /** Today's queue (see lib/queue.ts): only these items are listed. */
  queue: QueueEntry[];
  /** Due today beyond the daily limits (not listed). */
  overload: { topics: number; cards: number };
  autoPostpone: boolean;
  /** Reschedules the documents and extracts beyond the limit, now. */
  onPostponeSurplus: () => void;
  /** When the next item after today is due (shown when the queue is empty). */
  nextDueDate: Date | null;
  onEditItem: (type: 'extract' | 'cloze', id: string) => void;
}

export const QueueView: React.FC<QueueViewProps> = ({
  documents,
  extracts,
  clozes,
  onSelectDocument,
  onStartReview,
  onDeleteItem,
  onOpenImport,
  queue,
  overload,
  autoPostpone,
  onPostponeSurplus,
  nextDueDate,
  onEditItem,
}) => {
  const [filterType, setFilterType] = useState<'all' | 'document' | 'extract' | 'cloze'>('all');
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
        // Visible text (no Markdown syntax), shortened
        preview: projectMarkdown(doc.content.slice(0, 600)).text.slice(0, 180) + '…',
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
        title: clz.documentTitle || 'Carte',
        // The answer stays hidden until the review.
        preview: cardPreview(clz),
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


  // The reading queue is today's to-do list: items leave it once done for today.
  const queueOrder = new Map(queue.map((entry, index) => [entry.item.id, index]));
  const todayItems = queueItems
    .filter((item) => queueOrder.has(item.id))
    .sort((a, b) => queueOrder.get(a.id)! - queueOrder.get(b.id)!);
  const countOf = (type: ItemType) => todayItems.filter((i) => i.type === type).length;

  const filteredItems = todayItems
    .filter((item) => {
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
        return matchesQuery(searchQuery, [item.title, item.preview, ...item.tags]);
      }
      return true;
    });

  // Extracts and cards to review (documents are read in the reader).
  const dueCount = todayItems.length - countOf('document');

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* En-tête */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8 pb-6 border-b border-[var(--bd-e8e2d5)]">
        <div>
          <h1 className="page-title">File de lecture du jour</h1>
          <p className="mt-1 text-sm text-[var(--fg-695f54)]">
            {todayItems.length === 0
              ? 'Tout est fait pour aujourd’hui.'
              : `${todayItems.length} élément${todayItems.length > 1 ? 's' : ''} à traiter aujourd’hui : ${countOf('document')} à lire, ${dueCount} à réviser. Chacun quitte la file une fois fait.`}
          </p>
          {(overload.topics > 0 || overload.cards > 0) && (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--fg-8c8072)]" data-testid="overload">
              <span>
                Au-delà de vos limites du jour (Réglages) :{' '}
                {[
                  overload.topics > 0 &&
                    `${overload.topics} document${overload.topics > 1 ? 's' : ''} ou extrait${overload.topics > 1 ? 's' : ''} ${
                      autoPostpone ? 'reportés demain matin' : 'en attente'
                    }`,
                  overload.cards > 0 && `${overload.cards} carte${overload.cards > 1 ? 's' : ''} en attente`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {overload.topics > 0 && (
                <button
                  type="button"
                  onClick={onPostponeSurplus}
                  className="px-2 py-0.5 rounded-md border border-[var(--bd-e8e2d5)] text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] hover:bg-[var(--bg-f3efe8)] cursor-pointer"
                  title="Reprogrammer maintenant les moins prioritaires, plus loin s'ils comptent peu"
                >
                  Reporter maintenant
                </button>
              )}
            </p>
          )}
        </div>

        {dueCount > 0 ? (
          <button
            onClick={() => onStartReview()}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-[var(--bg-8c5e32)] hover:bg-[var(--bg-774d27)] rounded-lg shadow-xs transition-all cursor-pointer"
            title="Réviser les extraits et cartes du jour (les documents se lisent dans le lecteur)"
          >
            <Sparkles className="w-4 h-4" />
            <span>Réviser ({dueCount})</span>
          </button>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-[var(--fg-5f8550)]">
            <CheckCircle2 className="w-4 h-4" />
            <span>Révisions à jour</span>
          </div>
        )}
      </div>

      {/* Barre de filtres et recherche */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 mb-6">
        {/* Contrôle segmenté de filtrage en blanc et beige */}
        <div className="flex items-center gap-1 p-1 bg-[var(--bg-f3efe8)] border border-[var(--bd-e8e2d5)] rounded-lg overflow-x-auto">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              filterType === 'all'
                ? 'bg-[var(--bg-ffffff)] text-[var(--fg-28231d)] shadow-xs font-semibold'
                : 'text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)]'
            }`}
          >
            Tout ({todayItems.length})
          </button>
          <button
            onClick={() => setFilterType('document')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              filterType === 'document'
                ? 'bg-[var(--bg-ffffff)] text-[var(--fg-28231d)] shadow-xs font-semibold'
                : 'text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)]'
            }`}
          >
            Documents ({countOf('document')})
          </button>
          <button
            onClick={() => setFilterType('extract')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              filterType === 'extract'
                ? 'bg-[var(--bg-ffffff)] text-[var(--fg-28231d)] shadow-xs font-semibold'
                : 'text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)]'
            }`}
          >
            Extraits ({countOf('extract')})
          </button>
          <button
            onClick={() => setFilterType('cloze')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              filterType === 'cloze'
                ? 'bg-[var(--bg-ffffff)] text-[var(--fg-28231d)] shadow-xs font-semibold'
                : 'text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)]'
            }`}
          >
            Cartes ({countOf('cloze')})
          </button>
        </div>

        {/* Filtre par dossier d'arborescence */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-f3efe8)] border border-[var(--bd-e8e2d5)] rounded-lg text-xs text-[var(--fg-4a3e31)]">
            <Folder className="w-3.5 h-3.5 text-[var(--fg-8c5e32)] shrink-0" />
            <select
              value={selectedFolder}
              onChange={(e) => setSelectedFolder(e.target.value)}
              className="bg-transparent text-xs font-medium text-[var(--fg-28231d)] focus:outline-none cursor-pointer"
            >
              <option value="all">Tous les dossiers</option>
              {Array.from(new Set(todayItems.map((i) => i.folder || 'Général')))
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
          <Search className="w-4 h-4 text-[var(--fg-9e9385)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Rechercher dans la file…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--bd-8c5e32)] text-[var(--fg-28231d)] placeholder:text-[var(--fg-9e9385)]"
          />
        </div>
      </div>

      {/* Liste des cartes en blanc avec bordures beige */}
      {filteredItems.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-[var(--bd-ddd6c8)] rounded-xl bg-[var(--bg-ffffff)]/60">
          {todayItems.length === 0 ? (
            <>
              <CheckCircle2 className="w-10 h-10 mx-auto text-[var(--fg-5f8550)] mb-3" />
              <h3 className="text-base font-semibold text-[var(--fg-28231d)]">File vide : rien d’autre à faire aujourd’hui</h3>
              <p className="text-xs text-[var(--fg-695f54)] max-w-sm mx-auto mt-1 mb-4">
                {nextDueDate
                  ? `Prochain élément : ${nextDueDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}. Vous pouvez ajouter une nouvelle source en attendant.`
                  : 'Ajoutez une source pour commencer la lecture incrémentale.'}
              </p>
              <button
                onClick={onOpenImport}
                className="px-4 py-2 text-xs font-semibold text-[var(--fg-faf7f2)] bg-[var(--bg-3b3026)] hover:bg-[var(--bg-28211a)] rounded-lg shadow-xs"
              >
                Ajouter une source
              </button>
            </>
          ) : (
            <>
              <Layers className="w-10 h-10 mx-auto text-[var(--fg-9e9385)] mb-3" />
              <h3 className="text-base font-semibold text-[var(--fg-28231d)]">Aucun élément ne correspond</h3>
              <p className="text-xs text-[var(--fg-695f54)] max-w-sm mx-auto mt-1">
                Changez le type, le dossier ou la recherche.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const isDoc = item.type === 'document';
            const isExtract = item.type === 'extract';
            const isCloze = item.type === 'cloze';
            const parentDoc = isExtract ? docMap.get((item.originalItem as ExtractItem).documentId) : undefined;
            const open = () => (isDoc ? onSelectDocument(item.originalItem as DocumentItem) : onStartReview(item.id));
            // Scheduling details: secondary, shown on hover / focus.
            const details = [
              `priorité ${item.priority} %`,
              item.reps === 0
                ? 'jamais vu'
                : isCloze
                  ? `${item.reps} révision${item.reps > 1 ? 's' : ''} · stabilité ${formatInterval(item.stability)}`
                  : `${item.reps} lecture${item.reps > 1 ? 's' : ''} · intervalle ${formatInterval(item.originalItem.fsrs.interval)}`,
              ...(isDoc && item.readingProgress ? [`lu à ${item.readingProgress} %`] : []),
            ].join(' · ');

            return (
              <div
                key={`${item.type}-${item.id}`}
                className="group p-4 bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] hover:border-[var(--bd-d0c6b3)] rounded-xl transition-colors"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs text-[var(--fg-695f54)] mb-1 flex-wrap">
                      <span className="font-semibold text-[var(--fg-3b3026)] uppercase tracking-wider text-[10px]">
                        {isCloze ? cardKindLabel(item.originalItem as ClozeItem) : TYPE_LABEL[item.type]}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1">
                        <Folder className="w-3 h-3 text-[var(--fg-8c8072)]" />
                        {item.folder || 'Général'}
                      </span>
                      <span className="queue-details tabular-nums text-[var(--fg-8c8072)]">· {details}</span>
                    </div>

                    {isCloze ? (
                      <>
                        <p
                          onClick={open}
                          className="text-base text-[var(--fg-28231d)] font-serif-reading leading-relaxed cursor-pointer hover:text-[var(--fg-8c5e32)] transition-colors line-clamp-2"
                          dangerouslySetInnerHTML={{ __html: safeHtml(renderTextWithMath(item.preview)) }}
                        />
                        {item.sourceDocTitle && (
                          <p className="mt-1 text-xs text-[var(--fg-8c8072)] truncate">{item.sourceDocTitle}</p>
                        )}
                      </>
                    ) : (
                      <>
                        <h2
                          onClick={open}
                          className="text-base font-semibold text-[var(--fg-28231d)] hover:text-[var(--fg-8c5e32)] cursor-pointer transition-colors"
                        >
                          {item.title}
                        </h2>
                        <p className="mt-1 text-sm text-[var(--fg-4a4137)] line-clamp-2 leading-relaxed">
                          {isDoc ? (
                            item.preview
                          ) : (
                            <span dangerouslySetInnerHTML={{ __html: safeHtml(renderTextWithMath(item.preview)) }} />
                          )}
                        </p>
                      </>
                    )}
                    {item.tags.length > 0 && (
                      <p className="mt-2 text-xs text-[var(--fg-8c8072)]">{item.tags.join(' · ')}</p>
                    )}
                  </div>

                  {/* Une action principale, le reste en icônes */}
                  <div className="flex items-center gap-1 shrink-0">
                    {pendingDeleteId === item.id ? (
                      <>
                        <button
                          onClick={() => {
                            onDeleteItem?.(item.type, item.id);
                            setPendingDeleteId(null);
                          }}
                          className="px-2 py-1 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md cursor-pointer"
                        >
                          Supprimer
                        </button>
                        <button
                          onClick={() => setPendingDeleteId(null)}
                          className="px-2 py-1 text-xs text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] rounded-md cursor-pointer"
                        >
                          Annuler
                        </button>
                      </>
                    ) : (
                      <>
                        {isExtract && parentDoc && (
                          <button
                            onClick={() => onSelectDocument(parentDoc)}
                            className={ICON_BUTTON}
                            title={`Ouvrir le document « ${parentDoc.title} » dans le lecteur`}
                          >
                            <BookOpen className="w-4 h-4" />
                          </button>
                        )}
                        {!isDoc && (
                          <button
                            onClick={() => onEditItem(item.type as 'extract' | 'cloze', item.id)}
                            className={ICON_BUTTON}
                            title={isCloze ? 'Modifier la carte' : "Modifier l'extrait (et le passage dans le document)"}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        {onDeleteItem && (
                          <button
                            onClick={() => setPendingDeleteId(item.id)}
                            className={`${ICON_BUTTON} hover:!text-red-600`}
                            title="Supprimer définitivement"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={open}
                          className={`ml-1 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                            isDoc
                              ? 'text-[var(--fg-faf7f2)] bg-[var(--bg-3b3026)] hover:bg-[var(--bg-28211a)]'
                              : 'text-white bg-[var(--bg-8c5e32)] hover:bg-[var(--bg-774d27)]'
                          }`}
                        >
                          {isDoc ? <BookOpen className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                          <span>{isDoc ? 'Lire' : 'Réviser'}</span>
                        </button>
                      </>
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
