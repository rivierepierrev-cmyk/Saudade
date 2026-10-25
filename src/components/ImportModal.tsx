import React, { useState } from 'react';
import { DocumentItem } from '../types/foliole';
import { createInitialFSRSRecord } from '../lib/fsrs';
import { Globe, FileText, Upload, X, AlertCircle, Folder } from 'lucide-react';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddDocument: (doc: DocumentItem) => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({ isOpen, onClose, onAddDocument }) => {
  const [importMode, setImportMode] = useState<'url' | 'paste' | 'file'>('url');
  const [targetFolder, setTargetFolder] = useState('Général');

  const [urlInput, setUrlInput] = useState('');
  const [isClipping, setIsClipping] = useState(false);
  const [clipError, setClipError] = useState<string | null>(null);

  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteAuthor, setPasteAuthor] = useState('');
  const [pasteContent, setPasteContent] = useState('');
  const [pasteTags, setPasteTags] = useState('Lecture Incrémentale, Notes');
  const [pastePriority, setPastePriority] = useState(80);

  if (!isOpen) return null;

  const handleClipUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;

    setIsClipping(true);
    setClipError(null);

    try {
      const res = await fetch('/api/web-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Impossible de récupérer l\'article depuis cette URL');
      }

      const article = await res.json();

      let domain = 'Web';
      try {
        domain = new URL(urlInput.startsWith('http') ? urlInput : `https://${urlInput}`).hostname;
      } catch {}
      const isWiki = domain.includes('wikipedia.org');

      let formattedContent = article.content || '';
      if (!formattedContent.startsWith('# ') && article.title) {
        formattedContent = `# ${article.title}\n\n${formattedContent}`;
      }

      const newDoc: DocumentItem = {
        id: `doc-${Date.now()}`,
        title: article.title || 'Article Web Capturé',
        author: article.author || (isWiki ? 'Wikipédia' : domain),
        sourceUrl: urlInput.trim(),
        folder: targetFolder.trim() || 'Général',
        format: 'article',
        content: formattedContent,
        tags: isWiki ? ['Capture Web', 'Wikipédia'] : ['Capture Web', domain],
        priority: 85,
        readingProgress: 0,
        lastReadOffset: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        state: 'learning',
        extractedCount: 0,
        fsrs: createInitialFSRSRecord(0),
      };

      onAddDocument(newDoc);
      setUrlInput('');
      onClose();
    } catch (err: any) {
      console.error(err);
      setClipError(err.message || 'Erreur lors de la capture de l\'article');
    } finally {
      setIsClipping(false);
    }
  };

  const handleSavePaste = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pasteTitle.trim() || !pasteContent.trim()) return;

    const tags = pasteTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const newDoc: DocumentItem = {
      id: `doc-${Date.now()}`,
      title: pasteTitle.trim(),
      author: pasteAuthor.trim() || undefined,
      folder: targetFolder.trim() || 'Général',
      format: 'markdown',
      content: pasteContent.trim(),
      tags: tags.length > 0 ? tags : ['Notes'],
      priority: pastePriority,
      readingProgress: 0,
      lastReadOffset: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      state: 'learning',
      extractedCount: 0,
      fsrs: createInitialFSRSRecord(0),
    };

    onAddDocument(newDoc);
    setPasteTitle('');
    setPasteAuthor('');
    setPasteContent('');
    onClose();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = (event.target?.result as string) || '';
      const title = file.name.replace(/\.[^/.]+$/, '');

      const newDoc: DocumentItem = {
        id: `doc-${Date.now()}`,
        title,
        folder: targetFolder.trim() || 'Général',
        format: file.name.endsWith('.md') ? 'markdown' : 'book',
        content,
        tags: ['Fichier Local', file.name.split('.').pop() || 'txt'],
        priority: 75,
        readingProgress: 0,
        lastReadOffset: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        state: 'learning',
        extractedCount: 0,
        fsrs: createInitialFSRSRecord(0),
      };

      onAddDocument(newDoc);
      onClose();
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white border border-[#E8E2D5] rounded-2xl shadow-xl max-w-lg w-full overflow-hidden">
        {/* En-tête */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8E2D5]">
          <div>
            <h3 className="text-base font-bold text-[#28231D]">
              Ajouter une source de connaissance
            </h3>
            <p className="text-xs text-[#695F54]">
              Importez des textes longs, des articles ou des notes dans votre file de lecture.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#8C8072] hover:text-[#28231D] rounded-lg hover:bg-[#F3EFE8] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sélecteur de mode en beige et blanc */}
        <div className="flex border-b border-[#E8E2D5] bg-[#F3EFE8] text-xs font-medium">
          <button
            onClick={() => setImportMode('url')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 transition-colors cursor-pointer ${
              importMode === 'url'
                ? 'bg-white text-[#28231D] border-b-2 border-[#8C5E32] font-semibold'
                : 'text-[#695F54] hover:text-[#28231D]'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Capture Web</span>
          </button>

          <button
            onClick={() => setImportMode('paste')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 transition-colors cursor-pointer ${
              importMode === 'paste'
                ? 'bg-white text-[#28231D] border-b-2 border-[#8C5E32] font-semibold'
                : 'text-[#695F54] hover:text-[#28231D]'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Coller du texte</span>
          </button>

          <button
            onClick={() => setImportMode('file')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 transition-colors cursor-pointer ${
              importMode === 'file'
                ? 'bg-white text-[#28231D] border-b-2 border-[#8C5E32] font-semibold'
                : 'text-[#695F54] hover:text-[#28231D]'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Fichier local</span>
          </button>
        </div>

        {/* Dossier de destination global pour l'import */}
        <div className="px-6 pt-4 pb-0 flex items-center justify-between gap-3">
          <label className="text-xs font-semibold text-[#4A3E31] flex items-center gap-1.5 shrink-0">
            <Folder className="w-3.5 h-3.5 text-[#8C5E32]" />
            <span>Dossier cible :</span>
          </label>
          <input
            type="text"
            value={targetFolder}
            onChange={(e) => setTargetFolder(e.target.value)}
            placeholder="ex. Sciences/Neurobiologie ou Général"
            className="flex-1 text-xs px-2.5 py-1 bg-[#FAF7F2] border border-[#D5CBBF] rounded-lg text-[#28231D] font-mono focus:outline-none focus:ring-1 focus:ring-[#8C5E32]"
          />
        </div>

        {/* Mode 1 : URL Web Clip */}
        {importMode === 'url' && (
          <form onSubmit={handleClipUrl} className="p-6 pt-3 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#28231D] mb-1">
                URL de l'article ou de la page web
              </label>
              <input
                type="url"
                required
                placeholder="https://fr.wikipedia.org/wiki/Répétition_espacée"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-[#FAF7F2] border border-[#E8E2D5] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#8C5E32] text-[#28231D] font-mono placeholder-[#8C8072]"
              />
              <p className="mt-1 text-[11px] text-[#695F54]">
                L'application extrait automatiquement le texte, les titres et les images (ex. Wikipédia, articles, blogs) pour la lecture incrémentale.
              </p>
            </div>

            {clipError && (
              <div className="flex items-center gap-2 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{clipError}</span>
              </div>
            )}

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs text-[#695F54] hover:text-[#28231D] rounded-lg cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={isClipping || !urlInput.trim()}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#8C5E32] hover:bg-[#774D27] rounded-lg shadow-xs disabled:opacity-50 transition-all cursor-pointer"
              >
                {isClipping ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Extraction en cours...</span>
                  </>
                ) : (
                  <>
                    <Globe className="w-3.5 h-3.5" />
                    <span>Capturer & Ajouter</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Mode 2 : Texte ou Markdown collé */}
        {importMode === 'paste' && (
          <form onSubmit={handleSavePaste} className="p-6 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-[#28231D] mb-1">
                Titre du document
              </label>
              <input
                type="text"
                required
                placeholder="ex. La Théorie de la Charge Cognitive"
                value={pasteTitle}
                onChange={(e) => setPasteTitle(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-[#FAF7F2] border border-[#E8E2D5] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#8C5E32] text-[#28231D] placeholder-[#8C8072]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#28231D] mb-1">
                  Auteur (facultatif)
                </label>
                <input
                  type="text"
                  placeholder="ex. John Sweller"
                  value={pasteAuthor}
                  onChange={(e) => setPasteAuthor(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-[#FAF7F2] border border-[#E8E2D5] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#8C5E32] text-[#28231D] placeholder-[#8C8072]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#28231D] mb-1">
                  Tags (séparés par des virgules)
                </label>
                <input
                  type="text"
                  placeholder="Psychologie, Apprentissage"
                  value={pasteTags}
                  onChange={(e) => setPasteTags(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-[#FAF7F2] border border-[#E8E2D5] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#8C5E32] text-[#28231D] placeholder-[#8C8072]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#28231D] mb-1">
                Contenu (Markdown ou texte brut)
              </label>
              <textarea
                required
                rows={6}
                placeholder="Collez le texte de l'article, vos notes ou un chapitre de livre ici..."
                value={pasteContent}
                onChange={(e) => setPasteContent(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-[#FAF7F2] border border-[#E8E2D5] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#8C5E32] text-[#28231D] font-mono placeholder-[#8C8072]"
              />
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs text-[#695F54] hover:text-[#28231D] rounded-lg cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-[#8C5E32] hover:bg-[#774D27] rounded-lg shadow-xs cursor-pointer"
              >
                Ajouter à la file
              </button>
            </div>
          </form>
        )}

        {/* Mode 3 : Fichier local */}
        {importMode === 'file' && (
          <div className="p-8 text-center">
            <div className="border-2 border-dashed border-[#E8E2D5] rounded-2xl p-8 hover:border-[#8C5E32] transition-colors bg-[#FAF7F2]">
              <Upload className="w-8 h-8 text-[#8C8072] mx-auto mb-2" />
              <p className="text-xs font-semibold text-[#28231D] mb-1">
                Choisissez un fichier Markdown, Texte ou Notes
              </p>
              <p className="text-[11px] text-[#8C8072] mb-4">
                Formats acceptés : .md, .txt, .markdown
              </p>
              <label className="cursor-pointer inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#8C5E32] hover:bg-[#774D27] rounded-lg shadow-xs">
                <span>Sélectionner un fichier local</span>
                <input
                  type="file"
                  accept=".md,.txt,.markdown"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
