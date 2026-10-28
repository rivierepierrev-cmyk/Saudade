import React, { useState } from 'react';
import { DocumentItem, ExtractItem, ClozeItem } from '../types/saudade';
import { matchesQuery } from '../lib/search';
import { clozeAnswerPreview, renderTextWithMath } from '../lib/math';
import { safeHtml } from '../lib/markdown';
import {
  Search,
  BookOpen,
  Trash2,
  ExternalLink,
  Check,
  FileText,
  Sparkles,
  Layers,
  Edit3,
  FolderTree,
  LayoutGrid,
  Pencil,
} from 'lucide-react';
import { EditDocumentModal } from './EditDocumentModal';
import { KnowledgeTreeView } from './KnowledgeTreeView';

interface LibraryViewProps {
  documents: DocumentItem[];
  extracts: ExtractItem[];
  clozes: ClozeItem[];
  onSelectDocument: (doc: DocumentItem) => void;
  onUpdateDocument?: (doc: DocumentItem) => void;
  onDeleteDocument: (docId: string) => void;
  onDeleteExtract: (extractId: string) => void;
  onDeleteCloze: (clozeId: string) => void;
  onStartReviewWithFolder?: (folderPath: string) => void;
  onOpenImport: () => void;
  onExportMarkdown?: () => void;
  onEditItem?: (type: 'extract' | 'cloze', id: string) => void;
  onViewItem?: (type: 'extract' | 'cloze', id: string) => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  documents,
  extracts,
  clozes,
  onSelectDocument,
  onUpdateDocument,
  onDeleteDocument,
  onDeleteExtract,
  onDeleteCloze,
  onEditItem,
  onViewItem,
  onStartReviewWithFolder,
  onOpenImport,
}) => {
  const [libraryViewMode, setLibraryViewMode] = useState<'tree' | 'grid'>('tree');
  const [objectTab, setObjectTab] = useState<'documents' | 'extracts' | 'clozes'>('documents');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [inAppToast, setInAppToast] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [documentToEdit, setDocumentToEdit] = useState<DocumentItem | null>(null);

  const showToast = (msg: string) => {
    setInAppToast(msg);
    setTimeout(() => setInAppToast(null), 3000);
  };

  // Tags collectés
  const allTags = Array.from(
    new Set([
      ...documents.flatMap((d) => d.tags),
      ...extracts.flatMap((e) => e.tags),
      ...clozes.flatMap((c) => c.tags),
    ])
  );

  // Filtrage selon l'onglet d'objet sélectionné
  const filteredDocs = documents.filter((doc) => {
    if (selectedTag !== 'all' && !doc.tags.includes(selectedTag)) return false;
    if (searchQuery.trim()) {
      return matchesQuery(searchQuery, [doc.title, doc.author, ...doc.tags, doc.content]);
    }
    return true;
  });

  const filteredExtracts = extracts.filter((ext) => {
    if (selectedTag !== 'all' && !ext.tags.includes(selectedTag)) return false;
    if (searchQuery.trim()) {
      return matchesQuery(searchQuery, [ext.text, ext.note, ext.documentTitle, ...ext.tags]);
    }
    return true;
  });

  const filteredClozes = clozes.filter((clz) => {
    if (selectedTag !== 'all' && !clz.tags.includes(selectedTag)) return false;
    if (searchQuery.trim()) {
      return matchesQuery(searchQuery, [clz.text, clz.note, clz.documentTitle, ...clz.tags]);
    }
    return true;
  });

  const handleDeleteDocConfirm = (docId: string) => {
    onDeleteDocument(docId);
    setPendingDeleteId(null);
  };

  const handleDeleteExtractConfirm = (extId: string) => {
    onDeleteExtract(extId);
    setPendingDeleteId(null);
  };

  const handleDeleteClozeConfirm = (clzId: string) => {
    onDeleteCloze(clzId);
    setPendingDeleteId(null);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* En-tête : titre et mode d'affichage (ajouter une source : en haut de l'app) */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6 pb-6 border-b border-[var(--bd-e8e2d5)]">
        <h1 className="page-title">Bibliothèque</h1>
        <div role="tablist" aria-label="Affichage" className="flex items-center gap-1 p-1 bg-[var(--bg-f3efe8)] border border-[var(--bd-e8e2d5)] rounded-lg text-xs">
          {([
            ['tree', 'Dossiers', FolderTree],
            ['grid', 'Par type', LayoutGrid],
          ] as const).map(([mode, label, Icon]) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={libraryViewMode === mode}
              onClick={() => setLibraryViewMode(mode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                libraryViewMode === mode
                  ? 'bg-[var(--bg-ffffff)] text-[var(--fg-28231d)] font-semibold shadow-xs'
                  : 'text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Affichage conditionnel selon le mode choisi */}
      {libraryViewMode === 'tree' ? (
        <KnowledgeTreeView
          documents={documents}
          extracts={extracts}
          clozes={clozes}
          onSelectDocument={onSelectDocument}
          onUpdateDocument={onUpdateDocument}
          onDeleteDocument={onDeleteDocument}
          onDeleteExtract={onDeleteExtract}
          onDeleteCloze={onDeleteCloze}
          onEditItem={onEditItem}
          onViewItem={onViewItem}
          onStartReviewWithFolder={onStartReviewWithFolder}
          onOpenEditModal={(doc) => setDocumentToEdit(doc)}
          onOpenImport={onOpenImport}
        />
      ) : (
        <>
          {/* Onglets des types d'objets (Documents, Extraits, Clozes) */}
          <div className="flex items-center gap-2 mb-6 border-b border-[var(--bd-e8e2d5)] pb-3 overflow-x-auto">
        <button
          onClick={() => {
            setObjectTab('documents');
            setPendingDeleteId(null);
          }}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            objectTab === 'documents'
              ? 'bg-[var(--bg-3b3026)] text-[var(--fg-faf7f2)] font-semibold shadow-xs'
              : 'bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] text-[var(--fg-695f54)] hover:bg-[var(--bg-f3efe8)]'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Documents ({documents.length})</span>
        </button>

        <button
          onClick={() => {
            setObjectTab('extracts');
            setPendingDeleteId(null);
          }}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            objectTab === 'extracts'
              ? 'bg-[var(--bg-3b3026)] text-[var(--fg-faf7f2)] font-semibold shadow-xs'
              : 'bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] text-[var(--fg-695f54)] hover:bg-[var(--bg-f3efe8)]'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Extraits ({extracts.length})</span>
        </button>

        <button
          onClick={() => {
            setObjectTab('clozes');
            setPendingDeleteId(null);
          }}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
            objectTab === 'clozes'
              ? 'bg-[var(--bg-3b3026)] text-[var(--fg-faf7f2)] font-semibold shadow-xs'
              : 'bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] text-[var(--fg-695f54)] hover:bg-[var(--bg-f3efe8)]'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Cartes à trou ({clozes.length})</span>
        </button>
      </div>

      {/* Barre de filtres et recherche */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-1 p-1 bg-[var(--bg-f3efe8)] border border-[var(--bd-e8e2d5)] rounded-lg overflow-x-auto text-xs">
          <button
            onClick={() => setSelectedTag('all')}
            className={`px-3 py-1 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              selectedTag === 'all'
                ? 'bg-[var(--bg-ffffff)] text-[var(--fg-28231d)] font-semibold shadow-xs'
                : 'text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)]'
            }`}
          >
            Tous les tags ({allTags.length})
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              onClick={() => setSelectedTag(t)}
              className={`px-3 py-1 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                selectedTag === t
                  ? 'bg-[var(--bg-ffffff)] text-[var(--fg-28231d)] font-semibold shadow-xs'
                  : 'text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-[var(--fg-8c8072)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Rechercher par mot-clé..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--bd-8c5e32)] text-[var(--fg-28231d)] placeholder-[var(--fg-8c8072)]"
          />
        </div>
      </div>

      {/* --- VUE 1 : DOCUMENTS --- */}
      {objectTab === 'documents' && (
        <div>
          {filteredDocs.length === 0 ? (
            <div className="p-12 text-center border border-dashed border-[var(--bd-ddd6c8)] rounded-xl bg-[var(--bg-ffffff)]/60">
              <Layers className="w-10 h-10 mx-auto text-[var(--fg-9e9385)] mb-3" />
              <h3 className="text-base font-semibold text-[var(--fg-28231d)]">
                Aucun document correspondant
              </h3>
              <p className="text-xs text-[var(--fg-695f54)] max-w-sm mx-auto mt-1 mb-4">
                Importez un article ou réinitialisez votre recherche.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="p-5 bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-2xl hover:border-[var(--bd-d6cdbc)] transition-all flex flex-col justify-between shadow-xs"
                >
                  <div>
                    <div className="flex items-center justify-between text-xs text-[var(--fg-8c8072)] mb-2">
                      <span className="font-semibold text-[var(--fg-8c5e32)] uppercase tracking-wider text-[10px]">
                        {doc.format}
                      </span>
                      <span className="font-mono tabular-nums">Priorité : {doc.priority}%</span>
                    </div>

                    <h3
                      onClick={() => onSelectDocument(doc)}
                      className="text-base font-semibold text-[var(--fg-28231d)] hover:text-[var(--fg-8c5e32)] cursor-pointer line-clamp-2 transition-colors font-serif-reading"
                    >
                      {doc.title}
                    </h3>

                    {doc.author && (
                      <div className="text-xs text-[var(--fg-695f54)] mt-1">
                        Par {doc.author}
                      </div>
                    )}

                    <p className="mt-2 text-xs text-[var(--fg-695f54)] line-clamp-3 leading-relaxed">
                      {doc.content.slice(0, 150).replace(/[#*`_]/g, '')}...
                    </p>
                  </div>

                  <div className="mt-6 pt-4 border-t border-[var(--bd-f3efe8)]">
                    <div className="flex items-center justify-between text-[11px] text-[var(--fg-8c8072)] mb-1.5">
                      <span>Progression de lecture</span>
                      <span className="font-mono tabular-nums">{doc.readingProgress || 0}%</span>
                    </div>
                    <div className="w-full bg-[var(--bg-f3efe8)] h-1 rounded-full overflow-hidden mb-4">
                      <div
                        className="bg-[var(--bg-8c5e32)] h-1 rounded-full"
                        style={{ width: `${doc.readingProgress || 0}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => onSelectDocument(doc)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[var(--bg-8c5e32)] hover:bg-[var(--bg-774d27)] rounded-lg transition-colors cursor-pointer"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>Lire</span>
                      </button>

                      <div className="flex items-center gap-1">
                        {doc.sourceUrl && (
                          <a
                            href={doc.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="Ouvrir le lien source"
                            className="p-1.5 text-[var(--fg-8c8072)] hover:text-[var(--fg-28231d)] rounded"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}

                        {onUpdateDocument && (
                          <button
                            onClick={() => setDocumentToEdit(doc)}
                            title="Modifier ce document (texte, tags, auteur, priorité)"
                            className="p-1.5 text-[var(--fg-8c8072)] hover:text-[var(--fg-8c5e32)] rounded transition-colors cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {pendingDeleteId === doc.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDeleteDocConfirm(doc.id)}
                              className="px-2 py-1 text-[10px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded cursor-pointer"
                              title="Supprimer ce document et tous ses extraits et cartes à trou"
                            >
                              Confirmer
                            </button>
                            <button
                              onClick={() => setPendingDeleteId(null)}
                              className="px-2 py-1 text-[10px] text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] rounded cursor-pointer"
                            >
                              Annuler
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setPendingDeleteId(doc.id)}
                            title="Supprimer ce document et retirer ses éléments de la file de lecture"
                            className="p-1.5 text-[var(--fg-8c8072)] hover:text-red-600 rounded transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* --- VUE 2 : EXTRAITS --- */}
      {objectTab === 'extracts' && (
        <div>
          {filteredExtracts.length === 0 ? (
            <div className="p-12 text-center border border-dashed border-[var(--bd-ddd6c8)] rounded-xl bg-[var(--bg-ffffff)]/60">
              <FileText className="w-10 h-10 mx-auto text-[var(--fg-9e9385)] mb-3" />
              <h3 className="text-base font-semibold text-[var(--fg-28231d)]">
                Aucun extrait enregistré
              </h3>
              <p className="text-xs text-[var(--fg-695f54)] max-w-sm mx-auto mt-1 mb-4">
                Surlignez du texte dans le lecteur pour extraire des passages clés dans votre file.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredExtracts.map((ext) => {
                const parentDoc = documents.find((d) => d.id === ext.documentId);

                return (
                  <div
                    key={ext.id}
                    className="p-5 bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-2xl hover:border-[var(--bd-d6cdbc)] transition-all flex flex-col justify-between shadow-xs"
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs text-[var(--fg-8c8072)] mb-2">
                        <span className="font-semibold text-[var(--fg-8c5e32)] uppercase tracking-wider text-[10px]">
                          Extrait Incrémental
                        </span>
                        <span className="font-mono tabular-nums">Prio : {ext.priority}%</span>
                      </div>

                      <div className="text-xs text-[var(--fg-695f54)] mb-2 font-medium">
                        Document source : {ext.documentTitle}
                      </div>

                      <button
                        type="button"
                        onClick={() => onViewItem?.('extract', ext.id)}
                        title="Lire l'extrait"
                        className="block w-full text-left text-xs sm:text-sm text-[var(--fg-28231d)] italic leading-relaxed line-clamp-4 font-serif-reading rounded-md hover:bg-[var(--bg-faf7f2)] cursor-pointer"
                      >
                        « <span dangerouslySetInnerHTML={{ __html: safeHtml(renderTextWithMath(ext.text)) }} /> »
                      </button>
                    </div>

                    <div className="mt-6 pt-4 border-t border-[var(--bd-f3efe8)] flex items-center justify-between">
                      {parentDoc ? (
                        <button
                          onClick={() => onSelectDocument(parentDoc)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--fg-3b3026)] bg-[var(--bg-f3efe8)] hover:bg-[var(--bg-eae4d9)] border border-[var(--bd-e8e2d5)] rounded-lg transition-colors cursor-pointer"
                        >
                          <BookOpen className="w-3.5 h-3.5 text-[var(--fg-8c5e32)]" />
                          <span>Voir dans le document</span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-[var(--fg-8c8072)]">Fiche autonome</span>
                      )}

                      <div>
                        {pendingDeleteId === ext.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDeleteExtractConfirm(ext.id)}
                              className="px-2 py-1 text-[10px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded cursor-pointer"
                              title="Supprimer définitivement cet extrait de la file"
                            >
                              Confirmer
                            </button>
                            <button
                              onClick={() => setPendingDeleteId(null)}
                              className="px-2 py-1 text-[10px] text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] rounded cursor-pointer"
                            >
                              Annuler
                            </button>
                          </div>
                        ) : (
                          <span className="flex items-center">
                          {onEditItem && (
                            <button
                              onClick={() => onEditItem('extract', ext.id)}
                              title="Modifier l'extrait (et le passage dans le document)"
                              className="p-1.5 text-[var(--fg-8c8072)] hover:text-[var(--fg-28231d)] rounded transition-colors cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => setPendingDeleteId(ext.id)}
                            title="Supprimer cet extrait et le retirer de la file"
                            className="p-1.5 text-[var(--fg-8c8072)] hover:text-red-600 rounded transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* --- VUE 3 : CARTES CLOZE --- */}
      {objectTab === 'clozes' && (
        <div>
          {filteredClozes.length === 0 ? (
            <div className="p-12 text-center border border-dashed border-[var(--bd-ddd6c8)] rounded-xl bg-[var(--bg-ffffff)]/60">
              <Sparkles className="w-10 h-10 mx-auto text-[var(--fg-9e9385)] mb-3" />
              <h3 className="text-base font-semibold text-[var(--fg-28231d)]">
                Aucune carte cloze enregistrée
              </h3>
              <p className="text-xs text-[var(--fg-695f54)] max-w-sm mx-auto mt-1 mb-4">
                Créez des cartes à trou depuis le lecteur ou vos extraits pour alimenter vos révisions.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredClozes.map((clz) => {
                const parentDoc = documents.find((d) => d.id === clz.documentId);

                return (
                  <div
                    key={clz.id}
                    className="p-5 bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-2xl hover:border-[var(--bd-d6cdbc)] transition-all flex flex-col justify-between shadow-xs"
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs text-[var(--fg-8c8072)] mb-2">
                        <span className="font-semibold text-[var(--fg-8c5e32)] uppercase tracking-wider text-[10px]">
                          Carte à trou
                        </span>
                        <span className="font-mono tabular-nums">Prio : {clz.priority}%</span>
                      </div>

                      {clz.documentTitle && (
                        <div className="text-xs text-[var(--fg-695f54)] mb-2 font-medium">
                          Source : {clz.documentTitle}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => onViewItem?.('cloze', clz.id)}
                        title="Voir la carte"
                        className="block w-full text-left text-xs sm:text-sm text-[var(--fg-28231d)] leading-relaxed line-clamp-4 font-serif-reading font-medium rounded-md hover:bg-[var(--bg-faf7f2)] cursor-pointer"
                        dangerouslySetInnerHTML={{ __html: safeHtml(renderTextWithMath(clozeAnswerPreview(clz.text, clz.clozeNumber))) }}
                      />

                      {clz.note && (
                        <p className="text-[11px] text-[var(--fg-8c8072)] mt-2 italic">
                          Note : {clz.note}
                        </p>
                      )}
                    </div>

                    <div className="mt-6 pt-4 border-t border-[var(--bd-f3efe8)] flex items-center justify-between">
                      {parentDoc ? (
                        <button
                          onClick={() => onSelectDocument(parentDoc)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--fg-3b3026)] bg-[var(--bg-f3efe8)] hover:bg-[var(--bg-eae4d9)] border border-[var(--bd-e8e2d5)] rounded-lg transition-colors cursor-pointer"
                        >
                          <BookOpen className="w-3.5 h-3.5 text-[var(--fg-8c5e32)]" />
                          <span>Voir dans le document</span>
                        </button>
                      ) : (
                        <span />
                      )}

                      <div>
                        {pendingDeleteId === clz.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDeleteClozeConfirm(clz.id)}
                              className="px-2 py-1 text-[10px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded cursor-pointer"
                              title="Supprimer définitivement cette carte de la file"
                            >
                              Confirmer
                            </button>
                            <button
                              onClick={() => setPendingDeleteId(null)}
                              className="px-2 py-1 text-[10px] text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] rounded cursor-pointer"
                            >
                              Annuler
                            </button>
                          </div>
                        ) : (
                          <span className="flex items-center">
                          {onEditItem && (
                            <button
                              onClick={() => onEditItem('cloze', clz.id)}
                              title="Modifier la carte"
                              className="p-1.5 text-[var(--fg-8c8072)] hover:text-[var(--fg-28231d)] rounded transition-colors cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => setPendingDeleteId(clz.id)}
                            title="Supprimer cette carte à trou"
                            className="p-1.5 text-[var(--fg-8c8072)] hover:text-red-600 rounded transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      </>
      )}

      {/* Toast in-app */}
      {inAppToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 bg-[var(--bg-28231d)] text-[var(--fg-faf7f2)] rounded-xl shadow-lg text-xs font-medium border border-[var(--bd-3e3831)] animate-in slide-in-from-bottom-2">
          <Check className="w-4 h-4 text-[var(--fg-8eb87d)]" />
          <span>{inAppToast}</span>
        </div>
      )}

      {/* Modal d'édition de document */}
      {onUpdateDocument && (
        <EditDocumentModal
          isOpen={!!documentToEdit}
          document={documentToEdit}
          allAvailableTags={allTags}
          onClose={() => setDocumentToEdit(null)}
          onSave={(updated) => {
            onUpdateDocument(updated);
            showToast('Document et métadonnées mis à jour avec succès !');
          }}
        />
      )}
    </div>
  );
};
