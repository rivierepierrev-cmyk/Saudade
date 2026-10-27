import React, { useState } from 'react';
import { DocumentItem } from '../types/gemma';
import { renderMarkdown } from '../lib/markdown';
import {
  X,
  Check,
  FileEdit,
  Eye,
  Edit3,
  Tag,
  Plus,
  Heading2,
  Bold,
  Italic,
  Quote,
  Image as ImageIcon,
  HelpCircle,
  ExternalLink,
  Folder,
} from 'lucide-react';

interface EditDocumentModalProps {
  isOpen: boolean;
  document: DocumentItem | null;
  allAvailableTags?: string[];
  onClose: () => void;
  onSave: (updatedDocument: DocumentItem) => void;
}

export const EditDocumentModal: React.FC<EditDocumentModalProps> = ({
  isOpen,
  document,
  allAvailableTags = [],
  onClose,
  onSave,
}) => {
  if (!isOpen || !document) return null;

  const [title, setTitle] = useState(document.title);
  const [author, setAuthor] = useState(document.author || '');
  const [folder, setFolder] = useState(document.folder || 'Général');
  const [sourceUrl, setSourceUrl] = useState(document.sourceUrl || '');
  const [format, setFormat] = useState<DocumentItem['format']>(document.format);
  const [priority, setPriority] = useState<number>(document.priority);
  const [tags, setTags] = useState<string[]>([...document.tags]);
  const [newTagInput, setNewTagInput] = useState('');
  const [content, setContent] = useState(document.content);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');

  const handleAddTag = (tagToAdd?: string) => {
    const val = (tagToAdd || newTagInput).trim();
    if (!val) return;
    if (!tags.includes(val)) {
      setTags([...tags, val]);
    }
    setNewTagInput('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleInsertHelper = (snippet: string, cursorOffset = 0) => {
    const textarea = window.document.getElementById('edit-doc-content-textarea') as HTMLTextAreaElement | null;
    if (!textarea) {
      setContent((prev) => prev + '\n\n' + snippet);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentText = textarea.value;
    const selection = currentText.substring(start, end);

    let insertion = snippet;
    if (selection) {
      if (snippet === '****') {
        insertion = `**${selection}**`;
      } else if (snippet === '**') {
        insertion = `*${selection}*`;
      } else if (snippet.startsWith('## ')) {
        insertion = `## ${selection}`;
      } else if (snippet.startsWith('> ')) {
        insertion = `> ${selection}`;
      } else if (snippet.startsWith('{{c1::')) {
        insertion = `{{c1::${selection}}}`;
      }
    }

    const newContent = currentText.substring(0, start) + insertion + currentText.substring(end);
    setContent(newContent);

    setTimeout(() => {
      textarea.focus();
      const newPos = start + insertion.length - cursorOffset;
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;

    const updated: DocumentItem = {
      ...document,
      title: title.trim(),
      author: author.trim() || undefined,
      folder: folder.trim() || 'Général',
      sourceUrl: sourceUrl.trim() || undefined,
      format,
      priority,
      tags: tags.length > 0 ? tags : ['Notes'],
      content,
      updatedAt: new Date().toISOString(),
    };

    onSave(updated);
    onClose();
  };

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
  const charCount = content.length;
  const previewHtml = renderMarkdown(content || '*Aucun contenu*');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        {/* En-tête */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--bd-e8e2d5)] bg-[var(--bg-faf7f2)]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[var(--bg-f3efe8)] text-[var(--fg-8c5e32)] border border-[var(--bd-e8e2d5)]">
              <FileEdit className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[var(--fg-28231d)]">
                Modifier l'article & ses métadonnées
              </h2>
              <p className="text-xs text-[var(--fg-695f54)]">
                Ajustez le texte, les tags, l'auteur, le dossier et la priorité de ce document de lecture.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[var(--fg-8c8072)] hover:text-[var(--fg-28231d)] rounded-lg hover:bg-[var(--bg-e8e2d5)] transition-colors cursor-pointer"
            title="Fermer sans enregistrer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Corps formulaire à défilement */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Grille des métadonnées principales */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Titre */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[var(--fg-4a3e31)] mb-1.5">
                Titre du document <span className="text-[var(--fg-a84236)]">*</span>
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="ex. Les mécanismes de la mémoire synaptique"
                className="w-full text-sm font-medium px-3.5 py-2.5 bg-[var(--bg-faf7f2)] border border-[var(--bd-d5cbbf)] rounded-xl text-[var(--fg-28231d)] focus:outline-none focus:ring-2 focus:ring-[var(--bd-8c5e32)] focus:bg-[var(--bg-ffffff)] transition-all"
              />
            </div>

            {/* Auteur */}
            <div>
              <label className="block text-xs font-semibold text-[var(--fg-4a3e31)] mb-1.5">
                Auteur(s) / Source
              </label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="ex. Piotr Woźniak, Stanislas Dehaene"
                className="w-full text-sm px-3.5 py-2 bg-[var(--bg-faf7f2)] border border-[var(--bd-d5cbbf)] rounded-xl text-[var(--fg-28231d)] focus:outline-none focus:ring-2 focus:ring-[var(--bd-8c5e32)] focus:bg-[var(--bg-ffffff)] transition-all"
              />
            </div>

            {/* Dossier de classement */}
            <div>
              <label className="block text-xs font-semibold text-[var(--fg-4a3e31)] mb-1.5 flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-[var(--fg-8c5e32)]" />
                <span>Dossier de classement</span>
              </label>
              <input
                type="text"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="ex. Sciences/Neurobiologie ou Général"
                className="w-full text-sm px-3.5 py-2 bg-[var(--bg-faf7f2)] border border-[var(--bd-d5cbbf)] rounded-xl text-[var(--fg-28231d)] focus:outline-none focus:ring-2 focus:ring-[var(--bd-8c5e32)] focus:bg-[var(--bg-ffffff)] transition-all font-mono"
              />
            </div>

            {/* Format & Priorité */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--fg-4a3e31)] mb-1.5">
                  Format
                </label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as DocumentItem['format'])}
                  className="w-full text-xs font-medium px-3 py-2 bg-[var(--bg-faf7f2)] border border-[var(--bd-d5cbbf)] rounded-xl text-[var(--fg-28231d)] focus:outline-none focus:ring-2 focus:ring-[var(--bd-8c5e32)]"
                >
                  <option value="article">Article web</option>
                  <option value="markdown">Markdown</option>
                  <option value="book">Livre / Ouvrage</option>
                  <option value="note">Note libre</option>
                  <option value="pdf">Document PDF</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[var(--fg-4a3e31)]">
                    Priorité
                  </label>
                  <span className="text-xs font-mono font-bold text-[var(--fg-8c5e32)] tabular-nums">
                    {priority}%
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={priority}
                  onChange={(e) => setPriority(parseInt(e.target.value, 10))}
                  className="w-full h-2 bg-[var(--bg-f3efe8)] rounded-lg appearance-none cursor-pointer accent-[var(--fg-8c5e32)]"
                />
              </div>
            </div>

            {/* URL Source */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[var(--fg-4a3e31)] mb-1.5">
                URL Source originale
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://fr.wikipedia.org/wiki/..."
                  className="flex-1 text-xs px-3.5 py-2 bg-[var(--bg-faf7f2)] border border-[var(--bd-d5cbbf)] rounded-xl text-[var(--fg-28231d)] focus:outline-none focus:ring-2 focus:ring-[var(--bd-8c5e32)] focus:bg-[var(--bg-ffffff)] transition-all"
                />
                {sourceUrl && (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2 text-[var(--fg-695f54)] hover:text-[var(--fg-8c5e32)] bg-[var(--bg-f3efe8)] hover:bg-[var(--bg-e8e2d5)] rounded-xl border border-[var(--bd-e8e2d5)] transition-colors"
                    title="Ouvrir le lien source"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Gestion des Tags */}
          <div>
            <label className="block text-xs font-semibold text-[var(--fg-4a3e31)] mb-1.5">
              Tags & Catégories thématiques
            </label>
            <div className="flex flex-wrap items-center gap-1.5 mb-2 p-2.5 bg-[var(--bg-faf7f2)] border border-[var(--bd-d5cbbf)] rounded-xl min-h-[44px]">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-[var(--bg-ffffff)] text-[var(--fg-4a3e31)] border border-[var(--bd-d5cbbf)] rounded-lg shadow-2xs"
                >
                  <Tag className="w-3 h-3 text-[var(--fg-8c5e32)]" />
                  <span>{t}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(t)}
                    className="hover:text-[var(--fg-a84236)] p-0.5 rounded cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}

              <div className="flex items-center gap-1.5 ml-auto">
                <input
                  type="text"
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  placeholder="Nouveau tag..."
                  className="text-xs px-2.5 py-1 bg-[var(--bg-ffffff)] border border-[var(--bd-d5cbbf)] rounded-lg text-[var(--fg-28231d)] focus:outline-none focus:ring-1 focus:ring-[var(--bd-8c5e32)] w-28 sm:w-36"
                />
                <button
                  type="button"
                  onClick={() => handleAddTag()}
                  className="p-1 bg-[var(--bg-8c5e32)] hover:bg-[var(--bg-774d27)] text-white rounded-lg transition-colors cursor-pointer"
                  title="Ajouter ce tag"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Suggestions de tags existants */}
            {allAvailableTags.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-[var(--fg-695f54)]">
                <span className="text-[var(--fg-8c8072)]">Suggestions :</span>
                {allAvailableTags
                  .filter((t) => !tags.includes(t))
                  .slice(0, 6)
                  .map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => handleAddTag(tag)}
                      className="px-2 py-0.5 bg-[var(--bg-f3efe8)] hover:bg-[var(--bg-e8e2d5)] border border-[var(--bd-e8e2d5)] rounded-md transition-colors cursor-pointer"
                    >
                      + {tag}
                    </button>
                  ))}
              </div>
            )}
          </div>

          {/* Édition du contenu texte et images (Markdown) */}
          <div className="border border-[var(--bd-d5cbbf)] rounded-xl overflow-hidden bg-[var(--bg-ffffff)]">
            {/* Barre d'onglets et outils d'insertion */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[var(--bg-faf7f2)] border-b border-[var(--bd-d5cbbf)]">
              <div className="flex items-center gap-1 bg-[var(--bg-f3efe8)] p-0.5 rounded-lg">
                <button
                  type="button"
                  onClick={() => setActiveTab('edit')}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer ${
                    activeTab === 'edit'
                      ? 'bg-[var(--bg-ffffff)] text-[var(--fg-28231d)] shadow-2xs font-semibold'
                      : 'text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)]'
                  }`}
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Éditeur Markdown
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('preview')}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer ${
                    activeTab === 'preview'
                      ? 'bg-[var(--bg-ffffff)] text-[var(--fg-28231d)] shadow-2xs font-semibold'
                      : 'text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)]'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  Aperçu du rendu
                </button>
              </div>

              {activeTab === 'edit' && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleInsertHelper('## ')}
                    className="p-1.5 text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] hover:bg-[var(--bg-e8e2d5)] rounded-md transition-colors"
                    title="Insérer un titre (##)"
                  >
                    <Heading2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertHelper('****', 2)}
                    className="p-1.5 text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] hover:bg-[var(--bg-e8e2d5)] rounded-md transition-colors"
                    title="Gras (**texte**)"
                  >
                    <Bold className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertHelper('**', 1)}
                    className="p-1.5 text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] hover:bg-[var(--bg-e8e2d5)] rounded-md transition-colors"
                    title="Italique (*texte*)"
                  >
                    <Italic className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertHelper('> ')}
                    className="p-1.5 text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] hover:bg-[var(--bg-e8e2d5)] rounded-md transition-colors"
                    title="Citation (> texte)"
                  >
                    <Quote className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertHelper('![Description](https://url-image.jpg)\n*Légende*', 10)}
                    className="p-1.5 text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] hover:bg-[var(--bg-e8e2d5)] rounded-md transition-colors"
                    title="Insérer une image (![alt](url))"
                  >
                    <ImageIcon className="w-3.5 h-3.5 text-[var(--fg-8c5e32)]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertHelper('{{c1::terme à mémoriser}}', 2)}
                    className="p-1.5 text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] hover:bg-[var(--bg-e8e2d5)] rounded-md transition-colors"
                    title="Insérer une carte à trou ({{c1::...}})"
                  >
                    <HelpCircle className="w-3.5 h-3.5 text-[var(--fg-5f8550)]" />
                  </button>
                </div>
              )}
            </div>

            {/* Zone de texte ou aperçu */}
            {activeTab === 'edit' ? (
              <div className="relative">
                <textarea
                  id="edit-doc-content-textarea"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={16}
                  placeholder="Contenu complet du texte ou de l'article en Markdown..."
                  className="w-full p-4 text-sm font-mono text-[var(--fg-28231d)] bg-[var(--bg-ffffff)] leading-relaxed focus:outline-none resize-y"
                />
                <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--bd-f3efe8)] text-[11px] font-mono text-[var(--fg-8c8072)] bg-[var(--bg-faf7f2)]">
                  <span>Markdown (titres, images, listes) · formules LaTeX : $x^2$ dans le texte, $$…$$ en bloc</span>
                  <span>{wordCount} mots · {charCount} caractères</span>
                </div>
              </div>
            ) : (
              <div className="p-6 max-h-[460px] overflow-y-auto prose max-w-none text-[var(--fg-28231d)] font-serif leading-relaxed">
                <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </div>
            )}
          </div>
        </form>

        {/* Pied de page modal */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--bd-e8e2d5)] bg-[var(--bg-faf7f2)]">
          <span className="text-xs text-[var(--fg-695f54)]">
            Dernière mise à jour : {new Date(document.updatedAt || document.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] hover:bg-[var(--bg-e8e2d5)] rounded-xl transition-colors cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[var(--bg-8c5e32)] hover:bg-[var(--bg-774d27)] rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Enregistrer les modifications</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
