import React, { useState, useMemo } from 'react';
import { DocumentItem, ExtractItem, ClozeItem } from '../types/saudade';
import { SaudadeStorage } from '../lib/storage';
import { renderTextWithMath } from '../lib/math';
import { cardAnswerPreview } from '../lib/cards';
import { safeHtml } from '../lib/markdown';
import {
  Folder,
  FolderOpen,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  BookOpen,
  Scissors,
  Sparkles,
  FileText,
  Search,
  Plus,
  Trash2,
  Edit3,
  Move,
  Check,
  X,
  Play,
  Layers,
  GripVertical,
  CornerDownRight,
  Pencil,
} from 'lucide-react';

interface KnowledgeTreeViewProps {
  documents: DocumentItem[];
  extracts: ExtractItem[];
  clozes: ClozeItem[];
  onSelectDocument: (doc: DocumentItem) => void;
  onUpdateDocument?: (doc: DocumentItem) => void;
  onDeleteDocument: (docId: string) => void;
  onDeleteExtract: (extractId: string) => void;
  onDeleteCloze: (clozeId: string) => void;
  onEditItem?: (type: 'extract' | 'cloze', id: string) => void;
  onViewItem?: (type: 'extract' | 'cloze', id: string) => void;
  onStartReviewWithFolder?: (folderPath: string) => void;
  onOpenEditModal: (doc: DocumentItem) => void;
  onOpenImport?: () => void;
}

interface TreeNode {
  path: string; // full path, e.g. "Sciences/Neurobiologie"
  name: string; // leaf name, e.g. "Neurobiologie"
  depth: number;
  subfolders: TreeNode[];
  directDocs: DocumentItem[];
  totalDocCount: number;
  totalExtractCount: number;
  totalClozeCount: number;
  dueCount: number;
}

const FORMAT_LABEL: Record<string, string> = { article: 'Article', book: 'Livre', pdf: 'PDF', markdown: 'Markdown', note: 'Note' };

export const KnowledgeTreeView: React.FC<KnowledgeTreeViewProps> = ({
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
  onOpenEditModal,
  onOpenImport,
}) => {
  // Persistent list of custom folders from storage
  const [customFolders, setCustomFolders] = useState<string[]>(() => {
    return SaudadeStorage.getFolders();
  });

  const [selectedFolder, setSelectedFolder] = useState<string>('all');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    const initial = new Set<string>(['Apprentissage & Mémoire', 'Sciences', 'Philosophie']);
    SaudadeStorage.getFolders().forEach((f) => {
      const top = f.split('/')[0];
      initial.add(top);
    });
    return initial;
  });

  const [expandedDocIds, setExpandedDocIds] = useState<Set<string>>(new Set());
  const [folderSearch, setFolderSearch] = useState('');
  const [contentSearch, setContentSearch] = useState('');
  const [inAppToast, setInAppToast] = useState<string | null>(null);

  // Drag and Drop state
  const [draggedFolder, setDraggedFolder] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [draggedDocId, setDraggedDocId] = useState<string | null>(null);

  // Folder creation modal state
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderParent, setNewFolderParent] = useState('');

  // Folder rename modal state
  const [folderToRename, setFolderToRename] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');

  // Folder delete modal state
  const [folderToDelete, setFolderToDelete] = useState<string | null>(null);

  // Move document modal state
  const [movingDoc, setMovingDoc] = useState<DocumentItem | null>(null);
  const [targetMoveFolder, setTargetMoveFolder] = useState('');

  // Item deletion state
  const [pendingDelete, setPendingDelete] = useState<{ type: 'doc' | 'ext' | 'clz'; id: string } | null>(null);

  const showToast = (msg: string) => {
    setInAppToast(msg);
    setTimeout(() => setInAppToast(null), 3000);
  };

  // Union of customFolders and all document folders
  const allFolderPaths = useMemo(() => {
    const set = new Set<string>(customFolders);
    documents.forEach((d) => {
      const f = d.folder?.trim() || 'Général';
      set.add(f);
      const parts = f.split('/');
      let cur = '';
      for (const p of parts) {
        cur = cur ? `${cur}/${p.trim()}` : p.trim();
        set.add(cur);
      }
    });

    customFolders.forEach((f) => {
      const parts = f.split('/');
      let cur = '';
      for (const p of parts) {
        cur = cur ? `${cur}/${p.trim()}` : p.trim();
        set.add(cur);
      }
    });

    if (set.size === 0) set.add('Général');
    return Array.from(set).sort();
  }, [customFolders, documents]);

  // Build hierarchical tree structure
  const rootTreeNodes = useMemo(() => {
    const nodeMap = new Map<string, TreeNode>();

    // Initialize all nodes
    allFolderPaths.forEach((path) => {
      const parts = path.split('/');
      const name = parts[parts.length - 1];
      const depth = parts.length - 1;

      nodeMap.set(path, {
        path,
        name,
        depth,
        subfolders: [],
        directDocs: [],
        totalDocCount: 0,
        totalExtractCount: 0,
        totalClozeCount: 0,
        dueCount: 0,
      });
    });

    // Assign documents to direct nodes
    documents.forEach((doc) => {
      const f = doc.folder?.trim() || 'Général';
      const node = nodeMap.get(f);
      if (node) {
        node.directDocs.push(doc);
      }
    });

    const today = new Date().toISOString();

    // Compute totals and attach subfolders
    const roots: TreeNode[] = [];

    // First pass: attach children to parents
    allFolderPaths.forEach((path) => {
      const node = nodeMap.get(path);
      if (!node) return;

      const lastSlash = path.lastIndexOf('/');
      if (lastSlash === -1) {
        roots.push(node);
      } else {
        const parentPath = path.substring(0, lastSlash);
        const parentNode = nodeMap.get(parentPath);
        if (parentNode) {
          parentNode.subfolders.push(node);
        } else {
          roots.push(node);
        }
      }
    });

    // Second pass: recursively calculate counts
    const calculateTotals = (node: TreeNode) => {
      let docCount = node.directDocs.length;
      let extractCount = 0;
      let clozeCount = 0;
      let dueCount = node.directDocs.filter((d) => d.fsrs?.nextReviewDate <= today).length;

      const docIds = new Set(node.directDocs.map((d) => d.id));
      extracts.forEach((e) => {
        if (docIds.has(e.documentId) || e.folder === node.path) extractCount++;
      });
      clozes.forEach((c) => {
        if (
          (c.documentId && docIds.has(c.documentId)) ||
          c.folder === node.path
        ) {
          clozeCount++;
          if (c.fsrs?.nextReviewDate <= today) dueCount++;
        }
      });

      // Add subfolder totals
      node.subfolders.forEach((sub) => {
        calculateTotals(sub);
        docCount += sub.totalDocCount;
        extractCount += sub.totalExtractCount;
        clozeCount += sub.totalClozeCount;
        dueCount += sub.dueCount;
      });

      node.totalDocCount = docCount;
      node.totalExtractCount = extractCount;
      node.totalClozeCount = clozeCount;
      node.dueCount = dueCount;
    };

    roots.forEach((root) => calculateTotals(root));

    return { roots, nodeMap };
  }, [allFolderPaths, documents, extracts, clozes]);

  const toggleFolderExpand = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleDocExpand = (docId: string) => {
    setExpandedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  // Documents matching current folder selection
  const displayedDocs = useMemo(() => {
    return documents.filter((doc) => {
      const folder = doc.folder || 'Général';
      if (selectedFolder !== 'all') {
        const matchesFolder = folder === selectedFolder || folder.startsWith(`${selectedFolder}/`);
        if (!matchesFolder) return false;
      }
      if (contentSearch.trim()) {
        const q = contentSearch.toLowerCase();
        return (
          doc.title.toLowerCase().includes(q) ||
          (doc.author && doc.author.toLowerCase().includes(q)) ||
          doc.tags.some((t) => t.toLowerCase().includes(q)) ||
          doc.content.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [documents, selectedFolder, contentSearch]);

  // Create folder handler (persistent & immediately visible)
  const handleCreateFolder = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newFolderName.trim().replace(/\//g, ' - ');
    if (!cleanName) return;

    const fullPath = newFolderParent
      ? `${newFolderParent}/${cleanName}`
      : cleanName;

    // Save persistently
    const updated = Array.from(new Set([...customFolders, fullPath]));
    setCustomFolders(updated);
    SaudadeStorage.saveFolders(updated);

    // Expand parent and select new folder
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.add(fullPath);
      if (newFolderParent) next.add(newFolderParent);
      return next;
    });
    setSelectedFolder(fullPath);

    setNewFolderName('');
    setNewFolderParent('');
    setIsNewFolderOpen(false);
    showToast(`Dossier « ${cleanName} » créé avec succès !`);
  };

  // Rename folder handler
  const handleRenameFolder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderToRename || !renameInput.trim()) return;

    const oldPath = folderToRename;
    const parent = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
    const newName = renameInput.trim().replace(/\//g, ' - ');
    const newPath = parent ? `${parent}/${newName}` : newName;

    if (oldPath === newPath) {
      setFolderToRename(null);
      return;
    }

    // Update folder list
    const updatedFolders = customFolders.map((f) => {
      if (f === oldPath) return newPath;
      if (f.startsWith(`${oldPath}/`)) return `${newPath}${f.slice(oldPath.length)}`;
      return f;
    });
    setCustomFolders(updatedFolders);
    SaudadeStorage.saveFolders(updatedFolders);

    // Update documents in this folder
    if (onUpdateDocument) {
      documents.forEach((d) => {
        const curFolder = d.folder || 'Général';
        if (curFolder === oldPath) {
          onUpdateDocument({ ...d, folder: newPath });
        } else if (curFolder.startsWith(`${oldPath}/`)) {
          onUpdateDocument({ ...d, folder: `${newPath}${curFolder.slice(oldPath.length)}` });
        }
      });
    }

    if (selectedFolder === oldPath) {
      setSelectedFolder(newPath);
    } else if (selectedFolder.startsWith(`${oldPath}/`)) {
      setSelectedFolder(`${newPath}${selectedFolder.slice(oldPath.length)}`);
    }

    setFolderToRename(null);
    setRenameInput('');
    showToast(`Dossier renommé en « ${newName} »`);
  };

  // Delete folder handler
  const handleDeleteFolderConfirm = () => {
    if (!folderToDelete) return;

    // Remove from custom folders
    const updatedFolders = customFolders.filter(
      (f) => f !== folderToDelete && !f.startsWith(`${folderToDelete}/`)
    );
    setCustomFolders(updatedFolders);
    SaudadeStorage.saveFolders(updatedFolders);

    // Move any documents in this folder to 'Général' or parent
    if (onUpdateDocument) {
      const parent = folderToDelete.includes('/')
        ? folderToDelete.substring(0, folderToDelete.lastIndexOf('/'))
        : 'Général';

      documents.forEach((d) => {
        const cur = d.folder || 'Général';
        if (cur === folderToDelete || cur.startsWith(`${folderToDelete}/`)) {
          onUpdateDocument({ ...d, folder: parent });
        }
      });
    }

    setSelectedFolder('all');
    setFolderToDelete(null);
    showToast(`Dossier « ${folderToDelete} » supprimé`);
  };

  // Move document handler via modal
  const handleMoveDocSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!movingDoc || !targetMoveFolder.trim() || !onUpdateDocument) return;

    const folderDest = targetMoveFolder.trim();

    if (!customFolders.includes(folderDest)) {
      const updated = Array.from(new Set([...customFolders, folderDest]));
      setCustomFolders(updated);
      SaudadeStorage.saveFolders(updated);
    }

    const updatedDoc: DocumentItem = {
      ...movingDoc,
      folder: folderDest,
      updatedAt: new Date().toISOString(),
    };

    onUpdateDocument(updatedDoc);
    setMovingDoc(null);
    showToast(`Document déplacé vers « ${folderDest} »`);
  };

  // -------------------------------------------------------------
  // DRAG & DROP HANDLERS (SUBFOLDERS & DOCUMENTS)
  // -------------------------------------------------------------

  /**
   * Check if target folder is valid for dropping sourceFolder:
   * - Cannot drop onto itself
   * - Cannot drop into its own children or grandchildren
   * - Cannot drop onto its current direct parent (no-op)
   */
  const isValidFolderDrop = (sourcePath: string, targetPath: string | '__ROOT__'): boolean => {
    if (targetPath === '__ROOT__') {
      // Valid only if sourcePath is currently nested (has slashes)
      return sourcePath.includes('/');
    }
    if (sourcePath === targetPath) return false;
    // Cannot drop inside its own descendant
    if (targetPath.startsWith(`${sourcePath}/`)) return false;

    // Check if it's already a direct child of targetPath
    const lastSlash = sourcePath.lastIndexOf('/');
    const currentParent = lastSlash === -1 ? '' : sourcePath.substring(0, lastSlash);
    if (currentParent === targetPath) return false;

    return true;
  };

  /**
   * Perform move of a folder to targetPath ('__ROOT__' or another folder)
   */
  const handleMoveFolder = (sourcePath: string, targetPath: string | '__ROOT__') => {
    if (!isValidFolderDrop(sourcePath, targetPath)) return;

    const leafName = sourcePath.split('/').pop()!;
    const newPath = targetPath === '__ROOT__' ? leafName : `${targetPath}/${leafName}`;

    if (newPath === sourcePath) return;

    // 1. Update all customFolders
    const updatedFolders: string[] = [];
    customFolders.forEach((f) => {
      if (f === sourcePath) {
        updatedFolders.push(newPath);
      } else if (f.startsWith(`${sourcePath}/`)) {
        updatedFolders.push(`${newPath}${f.slice(sourcePath.length)}`);
      } else {
        updatedFolders.push(f);
      }
    });

    // Ensure all intermediate ancestor paths exist
    const parts = newPath.split('/');
    let cur = '';
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!updatedFolders.includes(cur)) {
        updatedFolders.push(cur);
      }
    }

    const uniqueFolders = Array.from(new Set(updatedFolders));
    setCustomFolders(uniqueFolders);
    SaudadeStorage.saveFolders(uniqueFolders);

    // 2. Cascade update to all documents
    if (onUpdateDocument) {
      documents.forEach((d) => {
        const curFolder = d.folder || 'Général';
        if (curFolder === sourcePath) {
          onUpdateDocument({ ...d, folder: newPath, updatedAt: new Date().toISOString() });
        } else if (curFolder.startsWith(`${sourcePath}/`)) {
          onUpdateDocument({
            ...d,
            folder: `${newPath}${curFolder.slice(sourcePath.length)}`,
            updatedAt: new Date().toISOString(),
          });
        }
      });
    }

    // 3. Keep UI selected & expanded nicely
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (targetPath !== '__ROOT__') next.add(targetPath);
      next.add(newPath);
      return next;
    });

    if (selectedFolder === sourcePath) {
      setSelectedFolder(newPath);
    } else if (selectedFolder.startsWith(`${sourcePath}/`)) {
      setSelectedFolder(`${newPath}${selectedFolder.slice(sourcePath.length)}`);
    }

    showToast(
      targetPath === '__ROOT__'
        ? `« ${leafName} » déplacé à la racine`
        : `« ${leafName} » déplacé dans « ${targetPath} »`
    );
  };

  /**
   * Perform move of a document into a folder via drag & drop
   */
  const handleDropDocOntoFolder = (docId: string, targetFolderPath: string) => {
    const doc = documents.find((d) => d.id === docId);
    if (!doc || !onUpdateDocument) return;
    if ((doc.folder || 'Général') === targetFolderPath) return;

    onUpdateDocument({
      ...doc,
      folder: targetFolderPath,
      updatedAt: new Date().toISOString(),
    });

    // Make sure folder exists in custom folders
    if (!customFolders.includes(targetFolderPath)) {
      const updated = Array.from(new Set([...customFolders, targetFolderPath]));
      setCustomFolders(updated);
      SaudadeStorage.saveFolders(updated);
    }

    showToast(`Document déplacé vers « ${targetFolderPath} »`);
  };

  const selectedNode = selectedFolder !== 'all' ? rootTreeNodes.nodeMap.get(selectedFolder) : null;

  // Render a folder row in sidebar with Drag & Drop support
  const renderFolderRow = (node: TreeNode) => {
    const isSelected = selectedFolder === node.path;
    const isExpanded = expandedFolders.has(node.path);
    const hasChildren = node.subfolders.length > 0;
    const isDraggingThis = draggedFolder === node.path;
    const isDragOverThis = dragOverFolder === node.path;

    const matchesSearch =
      !folderSearch.trim() ||
      node.path.toLowerCase().includes(folderSearch.toLowerCase());

    const canDropHere =
      draggedDocId !== null ||
      (draggedFolder !== null && isValidFolderDrop(draggedFolder, node.path));

    return (
      <div key={node.path} className="select-none">
        {matchesSearch && (
          <div
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', node.path);
              e.dataTransfer.setData('application/saudade-type', 'folder');
              e.dataTransfer.effectAllowed = 'move';
              setDraggedFolder(node.path);
            }}
            onDragEnd={() => {
              setDraggedFolder(null);
              setDragOverFolder(null);
              setDraggedDocId(null);
            }}
            onDragOver={(e) => {
              if (canDropHere) {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
                if (dragOverFolder !== node.path) {
                  setDragOverFolder(node.path);
                }
              }
            }}
            onDragLeave={(e) => {
              e.stopPropagation();
              if (dragOverFolder === node.path) {
                setDragOverFolder(null);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOverFolder(null);

              const saudadeType = e.dataTransfer.getData('application/saudade-type');
              if (saudadeType === 'folder' && draggedFolder) {
                handleMoveFolder(draggedFolder, node.path);
                setDraggedFolder(null);
              } else if (saudadeType === 'doc' && draggedDocId) {
                handleDropDocOntoFolder(draggedDocId, node.path);
                setDraggedDocId(null);
              } else if (draggedFolder) {
                handleMoveFolder(draggedFolder, node.path);
                setDraggedFolder(null);
              }
            }}
            style={{ paddingLeft: `${node.depth * 14 + 6}px` }}
            className={`group relative flex items-center justify-between pr-2 py-1.5 text-xs rounded-xl transition-all cursor-pointer text-left ${
              isDraggingThis
                ? 'opacity-30 border border-dashed border-[var(--bd-8c5e32)] bg-[var(--bg-f5ede4)]'
                : isDragOverThis && canDropHere
                ? 'bg-[var(--bg-ebddcf)] ring-2 ring-[var(--bd-8c5e32)] text-[var(--fg-28231d)] font-bold shadow-xs'
                : isSelected
                ? 'bg-[var(--bg-3b3026)] text-[var(--fg-faf7f2)] font-semibold shadow-2xs'
                : 'text-[var(--fg-4a3e31)] hover:bg-[var(--bg-f3efe8)]'
            }`}
            onClick={() => setSelectedFolder(node.path)}
          >
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {/* Drag Handle Indicator */}
              <span
                className="opacity-0 group-hover:opacity-60 hover:opacity-100 p-0.5 text-[var(--fg-8c8072)] cursor-grab active:cursor-grabbing shrink-0"
                title="Glisser pour déplacer dans l'arborescence"
              >
                <GripVertical className="w-3 h-3" />
              </span>

              {hasChildren ? (
                <button
                  type="button"
                  onClick={(e) => toggleFolderExpand(node.path, e)}
                  className="p-0.5 hover:text-[var(--fg-8c5e32)] rounded cursor-pointer shrink-0"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-[var(--fg-8c8072)]" />
                  )}
                </button>
              ) : (
                <span className="w-3.5 inline-block shrink-0" />
              )}

              {isExpanded || isSelected ? (
                <FolderOpen className="w-3.5 h-3.5 text-[var(--fg-8c5e32)] shrink-0" />
              ) : (
                <Folder className="w-3.5 h-3.5 text-[var(--fg-a87948)] shrink-0" />
              )}

              <span className="truncate" title={node.path}>
                {node.name}
              </span>
            </div>

            {/* Quick action buttons on hover */}
            <div className="flex items-center gap-1 shrink-0 ml-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setNewFolderParent(node.path);
                  setIsNewFolderOpen(true);
                }}
                className={`p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/10 ${
                  isSelected ? 'text-[var(--fg-faf7f2)]' : 'text-[var(--fg-8c5e32)]'
                }`}
                title="Ajouter un sous-dossier ici"
              >
                <Plus className="w-3 h-3" />
              </button>

              {node.dueCount > 0 && (
                <span
                  className="w-2 h-2 rounded-full bg-[var(--bg-d97706)]"
                  title={`${node.dueCount} révision(s) due(s) dans cette branche`}
                />
              )}

              <span
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md tabular-nums ${
                  isSelected
                    ? 'bg-[var(--bg-4e4134)] text-[var(--fg-e8e2d5)]'
                    : 'bg-[var(--bg-e8e2d5)] text-[var(--fg-695f54)]'
                }`}
              >
                {node.totalDocCount}
              </span>
            </div>
          </div>
        )}

        {/* Render child subfolders only when parent is expanded */}
        {(isExpanded || folderSearch.trim().length > 0) &&
          node.subfolders.map((child) => renderFolderRow(child))}
      </div>
    );
  };

  return (
    <div className="relative bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-2xl shadow-xs overflow-hidden flex flex-col md:flex-row min-h-[680px]">
      {/* Toast Notification */}
      {inAppToast && (
        <div className="absolute top-4 right-4 z-50 flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-[var(--fg-faf7f2)] bg-[var(--bg-3b3026)] rounded-xl shadow-lg border border-[var(--bd-8c5e32)]/30 animate-in fade-in slide-in-from-top-2">
          <Check className="w-4 h-4 text-[var(--fg-7bb369)]" />
          <span>{inAppToast}</span>
        </div>
      )}

      {/* --- VOLET GAUCHE : ARBORESCENCE DES DOSSIERS --- */}
      <aside className="w-full md:w-72 lg:w-80 border-b md:border-b-0 md:border-r border-[var(--bd-e8e2d5)] bg-[var(--bg-faf7f2)] p-4 flex flex-col shrink-0">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Folder className="w-4 h-4 text-[var(--fg-8c5e32)]" />
            <h2
              className="text-xs font-bold uppercase tracking-wider text-[var(--fg-695f54)]"
              title="Glissez un dossier ou un document sur un dossier pour le déplacer"
            >
              Dossiers
            </h2>
          </div>
          <button
            type="button"
            onClick={() => {
              setNewFolderParent(selectedFolder !== 'all' ? selectedFolder : '');
              setIsNewFolderOpen(true);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[var(--fg-8c5e32)] hover:text-white bg-[var(--bg-ffffff)] hover:bg-[var(--bg-8c5e32)] border border-[var(--bd-d5cbbf)] rounded-lg transition-colors cursor-pointer shadow-2xs"
            title="Créer un nouveau dossier racine ou sous-dossier"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>Nouveau</span>
          </button>
        </div>

        {/* Barre de recherche dans les dossiers */}
        <div className="relative mb-3">
          <Search className="w-3.5 h-3.5 text-[var(--fg-8c8072)] absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Filtrer les dossiers..."
            value={folderSearch}
            onChange={(e) => setFolderSearch(e.target.value)}
            className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--bd-8c5e32)] text-[var(--fg-28231d)]"
          />
        </div>

        {/* Zone de drop pour remettre à la RACINE si un sous-dossier est déplacé */}
        {draggedFolder && draggedFolder.includes('/') && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (dragOverFolder !== '__ROOT__') setDragOverFolder('__ROOT__');
            }}
            onDragLeave={() => {
              if (dragOverFolder === '__ROOT__') setDragOverFolder(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverFolder(null);
              if (draggedFolder) {
                handleMoveFolder(draggedFolder, '__ROOT__');
                setDraggedFolder(null);
              }
            }}
            className={`mb-2 p-2.5 rounded-xl border-2 border-dashed text-xs text-center transition-all ${
              dragOverFolder === '__ROOT__'
                ? 'bg-[var(--bg-ebddcf)] border-[var(--bd-8c5e32)] text-[var(--fg-28231d)] font-bold shadow-xs'
                : 'bg-[var(--bg-ffffff)]/80 border-[var(--bd-c9beb0)] text-[var(--fg-8c5e32)] hover:bg-[var(--bg-f3efe8)]'
            }`}
          >
            <div className="flex items-center justify-center gap-1.5">
              <CornerDownRight className="w-3.5 h-3.5 rotate-180 text-[var(--fg-8c5e32)]" />
              <span>Déposer ici pour déplacer à la racine</span>
            </div>
          </div>
        )}

        {/* Liste hiérarchique des dossiers */}
        <div className="flex-1 overflow-y-auto space-y-0.5 pr-1 max-h-[500px] md:max-h-none">
          {/* Racine / Tous les documents */}
          <button
            type="button"
            onClick={() => setSelectedFolder('all')}
            className={`w-full flex items-center justify-between px-2.5 py-2 text-xs rounded-xl transition-colors cursor-pointer text-left ${
              selectedFolder === 'all'
                ? 'bg-[var(--bg-3b3026)] text-[var(--fg-faf7f2)] font-semibold shadow-2xs'
                : 'text-[var(--fg-4a3e31)] hover:bg-[var(--bg-f3efe8)]'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Layers className="w-4 h-4 shrink-0 text-[var(--fg-8c5e32)]" />
              <span className="truncate">Tous les documents</span>
            </div>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md tabular-nums ${
                selectedFolder === 'all'
                  ? 'bg-[var(--bg-4e4134)] text-[var(--fg-e8e2d5)]'
                  : 'bg-[var(--bg-e8e2d5)] text-[var(--fg-695f54)]'
              }`}
            >
              {documents.length}
            </span>
          </button>

          {/* Rendu récursif des branches de dossiers */}
          {rootTreeNodes.roots.map((root) => renderFolderRow(root))}
        </div>

        {/* Bas de volet : informations */}
        <div className="mt-4 pt-3 border-t border-[var(--bd-e8e2d5)] flex items-center justify-between text-[11px] text-[var(--fg-8c8072)]">
          <span>{allFolderPaths.length} dossiers</span>
          <span>{documents.length} docs</span>
        </div>
      </aside>

      {/* --- VOLET DROIT : EXPLORATEUR DE CONTENU DU DOSSIER --- */}
      <main className="flex-1 p-5 md:p-6 overflow-y-auto flex flex-col">
        {/* Fil d'Ariane & Titre de dossier */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b border-[var(--bd-e8e2d5)]">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-[var(--fg-8c8072)] mb-1 flex-wrap">
              <span
                className="hover:text-[var(--fg-28231d)] cursor-pointer"
                onClick={() => setSelectedFolder('all')}
              >
                Bibliothèque
              </span>
              {selectedFolder !== 'all' && (
                <>
                  <span>/</span>
                  {selectedFolder.split('/').map((seg, idx, arr) => (
                    <React.Fragment key={seg}>
                      <span
                        className="hover:text-[var(--fg-28231d)] cursor-pointer font-semibold"
                        onClick={() => setSelectedFolder(arr.slice(0, idx + 1).join('/'))}
                      >
                        {seg}
                      </span>
                      {idx < arr.length - 1 && <span>/</span>}
                    </React.Fragment>
                  ))}
                </>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-semibold text-[var(--fg-28231d)] font-serif-reading flex items-center gap-2">
                <Folder className="w-5 h-5 text-[var(--fg-8c5e32)]" />
                <span>
                  {selectedFolder === 'all'
                    ? 'Tous les documents'
                    : selectedFolder.split('/').pop()}
                </span>
              </h2>

              {selectedFolder !== 'all' && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setFolderToRename(selectedFolder);
                      setRenameInput(selectedFolder.split('/').pop() || '');
                    }}
                    className="p-1 text-[var(--fg-8c8072)] hover:text-[var(--fg-8c5e32)] hover:bg-[var(--bg-f3efe8)] rounded-md transition-colors"
                    title="Renommer ce dossier"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setFolderToDelete(selectedFolder)}
                    className="p-1 text-[var(--fg-8c8072)] hover:text-red-600 hover:bg-[var(--bg-fdf2f0)] rounded-md transition-colors"
                    title="Supprimer ce dossier"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Actions rapides sur le dossier */}
          <div className="flex items-center gap-2 flex-wrap">
            {selectedNode && selectedNode.dueCount > 0 && onStartReviewWithFolder && (
              <button
                type="button"
                onClick={() => onStartReviewWithFolder(selectedFolder)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[var(--bg-8c5e32)] hover:bg-[var(--bg-774d27)] rounded-xl shadow-xs transition-colors cursor-pointer"
                title="Réviser les extraits et cartes de ce dossier"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Réviser ce dossier ({selectedNode.dueCount})</span>
              </button>
            )}


          </div>
        </div>

        {/* Sous-dossiers immédiats s'ils existent (avec support Drag & Drop) */}
        {selectedNode && selectedNode.subfolders.length > 0 && (
          <div className="mb-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-695f54)] mb-2.5">
              Sous-dossiers dans {selectedNode.name}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
              {selectedNode.subfolders.map((sub) => {
                const isOver = dragOverFolder === sub.path;
                return (
                  <div
                    key={sub.path}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', sub.path);
                      e.dataTransfer.setData('application/saudade-type', 'folder');
                      e.dataTransfer.effectAllowed = 'move';
                      setDraggedFolder(sub.path);
                    }}
                    onDragEnd={() => {
                      setDraggedFolder(null);
                      setDragOverFolder(null);
                    }}
                    onDragOver={(e) => {
                      if (draggedFolder && isValidFolderDrop(draggedFolder, sub.path)) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (dragOverFolder !== sub.path) setDragOverFolder(sub.path);
                      }
                    }}
                    onDragLeave={() => {
                      if (dragOverFolder === sub.path) setDragOverFolder(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverFolder(null);
                      if (draggedFolder) {
                        handleMoveFolder(draggedFolder, sub.path);
                        setDraggedFolder(null);
                      }
                    }}
                    onClick={() => setSelectedFolder(sub.path)}
                    className={`p-3 border rounded-xl cursor-pointer transition-all flex items-center justify-between group ${
                      isOver
                        ? 'bg-[var(--bg-ebddcf)] border-[var(--bd-8c5e32)] ring-2 ring-[var(--bd-8c5e32)]'
                        : 'bg-[var(--bg-faf7f2)] hover:bg-[var(--bg-f3efe8)] border-[var(--bd-e8e2d5)] hover:border-[var(--bd-d5cbbf)]'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <GripVertical className="w-3 h-3 text-[var(--fg-8c8072)] opacity-0 group-hover:opacity-100 cursor-grab shrink-0" />
                      <Folder className="w-4 h-4 text-[var(--fg-8c5e32)] shrink-0" />
                      <span className="text-xs font-medium text-[var(--fg-28231d)] truncate">
                        {sub.name}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono bg-[var(--bg-ffffff)] px-1.5 py-0.5 rounded border border-[var(--bd-e8e2d5)] text-[var(--fg-695f54)] tabular-nums">
                      {sub.totalDocCount}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recherche d'articles dans la branche */}
        <div className="relative mb-5">
          <Search className="w-4 h-4 text-[var(--fg-8c8072)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder={`Rechercher un document ou extrait dans ${
              selectedFolder === 'all' ? 'la bibliothèque' : selectedFolder
            }...`}
            value={contentSearch}
            onChange={(e) => setContentSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-xl focus:outline-none focus:ring-1 focus:ring-[var(--bd-8c5e32)] text-[var(--fg-28231d)]"
          />
        </div>

        {/* Liste des documents de la branche */}
        {displayedDocs.length === 0 ? (
          <div className="p-12 text-center border border-dashed border-[var(--bd-ddd6c8)] rounded-2xl bg-[var(--bg-faf7f2)]/60 my-auto">
            <Folder className="w-10 h-10 mx-auto text-[var(--fg-9e9385)] mb-2" />
            <h3 className="text-sm font-bold text-[var(--fg-28231d)]">
              Aucun document dans {selectedFolder === 'all' ? 'la bibliothèque' : `« ${selectedFolder} »`}
            </h3>
            <p className="text-xs text-[var(--fg-695f54)] max-w-sm mx-auto mt-1 mb-4">
              Ce dossier est vide pour le moment. Vous pouvez y créer un sous-dossier ou y importer un article.
            </p>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setNewFolderParent(selectedFolder !== 'all' ? selectedFolder : '');
                  setIsNewFolderOpen(true);
                }}
                className="px-3.5 py-2 text-xs font-semibold text-[var(--fg-8c5e32)] bg-[var(--bg-ffffff)] border border-[var(--bd-d5cbbf)] hover:bg-[var(--bg-f3efe8)] rounded-xl transition-colors cursor-pointer"
              >
                + Nouveau sous-dossier
              </button>
              {onOpenImport && (
                <button
                  type="button"
                  onClick={onOpenImport}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[var(--bg-8c5e32)] hover:bg-[var(--bg-774d27)] rounded-xl transition-colors cursor-pointer"
                >
                  Importer un document
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3 flex-1">
            {displayedDocs.map((doc) => {
              const isExpanded = expandedDocIds.has(doc.id);
              const docExtracts = extracts.filter((e) => e.documentId === doc.id);
              const docClozes = clozes.filter((c) => c.documentId === doc.id);
              const totalItems = docExtracts.length + docClozes.length;

              return (
                <div
                  key={doc.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', doc.id);
                    e.dataTransfer.setData('application/saudade-type', 'doc');
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggedDocId(doc.id);
                  }}
                  onDragEnd={() => {
                    setDraggedDocId(null);
                  }}
                  className="bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-2xl hover:border-[var(--bd-d5cbbf)] transition-all overflow-hidden shadow-2xs group"
                >
                  {/* Ligne Document */}
                  <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <span
                        className="opacity-0 group-hover:opacity-60 hover:opacity-100 p-1 text-[var(--fg-8c8072)] cursor-grab active:cursor-grabbing shrink-0 mt-0.5"
                        title="Glisser vers un dossier dans la colonne de gauche"
                      >
                        <GripVertical className="w-3.5 h-3.5" />
                      </span>

                      <button
                        type="button"
                        onClick={() => toggleDocExpand(doc.id)}
                        className="p-1 text-[var(--fg-8c8072)] hover:text-[var(--fg-28231d)] hover:bg-[var(--bg-f3efe8)] rounded-lg mt-0.5 cursor-pointer shrink-0"
                        title={isExpanded ? 'Replier les éléments' : 'Déplier les extraits et cartes'}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-[var(--fg-8c5e32)]" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap text-[10px] text-[var(--fg-8c8072)] mb-1">
                          <span className="font-semibold text-[var(--fg-8c5e32)] uppercase tracking-wider">
                            {FORMAT_LABEL[doc.format] ?? doc.format}
                          </span>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1 text-[var(--fg-695f54)]">
                            <Folder className="w-3 h-3" />
                            {doc.folder || 'Général'}
                          </span>
                          {doc.author && (
                            <>
                              <span>·</span>
                              <span>{doc.author}</span>
                            </>
                          )}
                          <span className="queue-details">· priorité {doc.priority} %</span>
                        </div>

                        <h3
                          onClick={() => onSelectDocument(doc)}
                          className="text-base font-semibold text-[var(--fg-28231d)] hover:text-[var(--fg-8c5e32)] cursor-pointer transition-colors font-serif-reading leading-snug truncate"
                          title={doc.title}
                        >
                          {doc.title}
                        </h3>

                        {/* Extraits & Clozes badges */}
                        <div className="flex items-center gap-3 mt-1.5 text-xs text-[var(--fg-695f54)]">
                          <span className="inline-flex items-center gap-1">
                            <Scissors className="w-3.5 h-3.5 text-[var(--fg-8c5e32)]" />
                            {docExtracts.length} extrait{docExtracts.length > 1 ? 's' : ''}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Sparkles className="w-3.5 h-3.5 text-[var(--fg-5f8550)]" />
                            {docClozes.length} carte{docClozes.length > 1 ? 's' : ''}
                          </span>
                          <span className="text-[var(--fg-8c8072)] tabular-nums">lu à {doc.readingProgress || 0} %</span>
                        </div>
                      </div>
                    </div>

                    {/* Actions sur le Document */}
                    <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                      <button
                        type="button"
                        onClick={() => onSelectDocument(doc)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-[var(--bg-8c5e32)] hover:bg-[var(--bg-774d27)] rounded-xl transition-colors cursor-pointer"
                        title="Ouvrir dans le lecteur incrémental"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>Lire</span>
                      </button>

                      {onUpdateDocument && (
                        <button
                          type="button"
                          onClick={() => {
                            setMovingDoc(doc);
                            setTargetMoveFolder(doc.folder || 'Général');
                          }}
                          className="p-1.5 text-[var(--fg-695f54)] hover:text-[var(--fg-8c5e32)] hover:bg-[var(--bg-f3efe8)] rounded-lg transition-colors cursor-pointer"
                          title="Déplacer vers un autre dossier"
                        >
                          <Move className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onOpenEditModal(doc)}
                        className="p-1.5 text-[var(--fg-695f54)] hover:text-[var(--fg-8c5e32)] hover:bg-[var(--bg-f3efe8)] rounded-lg transition-colors cursor-pointer"
                        title="Modifier l'article (texte, métadonnées, tags)"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>

                      {pendingDelete?.type === 'doc' && pendingDelete.id === doc.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteDocument(doc.id);
                              setPendingDelete(null);
                            }}
                            className="px-2 py-1 text-[10px] font-semibold text-white bg-red-600 rounded cursor-pointer"
                          >
                            Confirmer
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDelete(null)}
                            className="px-2 py-1 text-[10px] text-[var(--fg-695f54)] hover:bg-[var(--bg-e8e2d5)] rounded cursor-pointer"
                          >
                            Annuler
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPendingDelete({ type: 'doc', id: doc.id })}
                          className="p-1.5 text-[var(--fg-8c8072)] hover:text-red-600 hover:bg-[var(--bg-fdf2f0)] rounded-lg transition-colors cursor-pointer"
                          title="Supprimer ce document et ses extraits"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Arborescence dépliée : Extraits et Clozes enfants */}
                  {isExpanded && (
                    <div className="bg-[var(--bg-faf7f2)] border-t border-[var(--bd-e8e2d5)] p-4 pl-8 space-y-3">
                      {totalItems === 0 ? (
                        <p className="text-xs text-[var(--fg-8c8072)] italic">
                          Aucun extrait ou carte cloze n'a encore été découpé depuis cet article.
                        </p>
                      ) : (
                        <>
                          {/* Section Extraits */}
                          {docExtracts.length > 0 && (
                            <div>
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--fg-8c5e32)] mb-2">
                                <Scissors className="w-3.5 h-3.5" />
                                <span>Extraits textuels découplés ({docExtracts.length})</span>
                              </div>
                              <div className="space-y-1.5">
                                {docExtracts.map((ext) => (
                                  <div
                                    key={ext.id}
                                    className="p-2.5 bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-xl flex items-start justify-between gap-3 text-xs"
                                  >
                                    <div className="flex-1 min-w-0">
                                      <button
                                        type="button"
                                        onClick={() => onViewItem?.('extract', ext.id)}
                                        title="Lire l'extrait"
                                        className="block w-full text-left text-[var(--fg-28231d)] leading-relaxed line-clamp-2 rounded hover:bg-[var(--bg-faf7f2)] cursor-pointer"
                                      >
                                        « <span dangerouslySetInnerHTML={{ __html: safeHtml(renderTextWithMath(ext.text)) }} /> »
                                      </button>
                                      {ext.note && (
                                        <p className="text-[11px] text-[var(--fg-8c8072)] mt-1">
                                          Note : {ext.note}
                                        </p>
                                      )}
                                    </div>
                                    {onEditItem && (
                                      <button
                                        type="button"
                                        onClick={() => onEditItem('extract', ext.id)}
                                        className="p-1 text-[var(--fg-8c8072)] hover:text-[var(--fg-28231d)] rounded cursor-pointer"
                                        title="Modifier l'extrait (et le passage dans le document)"
                                      >
                                        <Pencil className="w-3 h-3" />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => onDeleteExtract(ext.id)}
                                      className="p-1 text-[var(--fg-8c8072)] hover:text-red-600 rounded cursor-pointer"
                                      title="Supprimer cet extrait"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Section Clozes FSRS */}
                          {docClozes.length > 0 && (
                            <div>
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--fg-5f8550)] mb-2">
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>Cartes ({docClozes.length})</span>
                              </div>
                              <div className="space-y-1.5">
                                {docClozes.map((clz) => {
                                  const isDue = clz.fsrs?.nextReviewDate <= new Date().toISOString();
                                  return (
                                    <div
                                      key={clz.id}
                                      className="p-2.5 bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-xl flex items-start justify-between gap-3 text-xs"
                                    >
                                      <div className="flex-1 min-w-0">
                                        <button
                                          type="button"
                                          onClick={() => onViewItem?.('cloze', clz.id)}
                                          title="Voir la carte"
                                          className="block w-full text-left text-[var(--fg-28231d)] leading-relaxed line-clamp-2 rounded hover:bg-[var(--bg-faf7f2)] cursor-pointer"
                                          dangerouslySetInnerHTML={{ __html: safeHtml(renderTextWithMath(cardAnswerPreview(clz))) }}
                                        />
                                        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-[var(--fg-8c8072)]">
                                          <span>Stabilité : {clz.fsrs?.stability?.toFixed(1) || 1}j</span>
                                          <span>Répétitions : {clz.fsrs?.reps || 0}</span>
                                          {isDue && (
                                            <span className="font-semibold text-[var(--fg-d97706)] bg-[var(--bg-fef3c7)] px-1.5 py-0.5 rounded">
                                              À réviser aujourd'hui
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      {onEditItem && (
                                        <button
                                          type="button"
                                          onClick={() => onEditItem('cloze', clz.id)}
                                          className="p-1 text-[var(--fg-8c8072)] hover:text-[var(--fg-28231d)] rounded cursor-pointer"
                                          title="Modifier la carte"
                                        >
                                          <Pencil className="w-3 h-3" />
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => onDeleteCloze(clz.id)}
                                        className="p-1 text-[var(--fg-8c8072)] hover:text-red-600 rounded cursor-pointer"
                                        title="Supprimer cette carte"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* --- MODAL : CRÉER UN NOUVEAU DOSSIER OU SOUS-DOSSIER --- */}
      {isNewFolderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[var(--fg-28231d)] flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-[var(--fg-8c5e32)]" />
                Nouveau dossier ou sous-dossier
              </h3>
              <button
                type="button"
                onClick={() => setIsNewFolderOpen(false)}
                className="p-1 text-[var(--fg-8c8072)] hover:text-[var(--fg-28231d)] rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateFolder} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--fg-4a3e31)] mb-1">
                  Emplacement / Dossier parent
                </label>
                <select
                  value={newFolderParent}
                  onChange={(e) => setNewFolderParent(e.target.value)}
                  className="w-full text-xs p-2 bg-[var(--bg-faf7f2)] border border-[var(--bd-e8e2d5)] rounded-xl text-[var(--fg-28231d)]"
                >
                  <option value="">(Racine - Dossier principal)</option>
                  {allFolderPaths.map((f) => (
                    <option key={f} value={f}>
                      📁 {f}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--fg-4a3e31)] mb-1">
                  Nom du dossier <span className="text-[var(--fg-a84236)]">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="ex. Neurobiologie, Épistémologie..."
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="w-full text-xs p-2.5 bg-[var(--bg-faf7f2)] border border-[var(--bd-d5cbbf)] rounded-xl text-[var(--fg-28231d)] focus:outline-none focus:ring-2 focus:ring-[var(--bd-8c5e32)]"
                />
              </div>

              {/* Aperçu du chemin */}
              {newFolderName.trim() && (
                <div className="p-2 bg-[var(--bg-faf7f2)] rounded-lg text-[11px] font-mono text-[var(--fg-695f54)] border border-[var(--bd-e8e2d5)]">
                  <span className="text-[var(--fg-8c8072)]">Chemin : </span>
                  {newFolderParent ? `${newFolderParent} / ` : ''}
                  <strong className="text-[var(--fg-8c5e32)]">{newFolderName.trim()}</strong>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsNewFolderOpen(false)}
                  className="px-3 py-1.5 text-xs text-[var(--fg-695f54)] hover:bg-[var(--bg-f3efe8)] rounded-lg cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-[var(--bg-8c5e32)] hover:bg-[var(--bg-774d27)] rounded-lg cursor-pointer"
                >
                  Créer le dossier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL : RENOMMER UN DOSSIER --- */}
      {folderToRename && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[var(--fg-28231d)] flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-[var(--fg-8c5e32)]" />
                Renommer le dossier
              </h3>
              <button
                type="button"
                onClick={() => setFolderToRename(null)}
                className="p-1 text-[var(--fg-8c8072)] hover:text-[var(--fg-28231d)] rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRenameFolder} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--fg-4a3e31)] mb-1">
                  Nouveau nom
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={renameInput}
                  onChange={(e) => setRenameInput(e.target.value)}
                  className="w-full text-xs p-2.5 bg-[var(--bg-faf7f2)] border border-[var(--bd-d5cbbf)] rounded-xl text-[var(--fg-28231d)] focus:outline-none focus:ring-2 focus:ring-[var(--bd-8c5e32)]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setFolderToRename(null)}
                  className="px-3 py-1.5 text-xs text-[var(--fg-695f54)] hover:bg-[var(--bg-f3efe8)] rounded-lg cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-[var(--bg-8c5e32)] hover:bg-[var(--bg-774d27)] rounded-lg cursor-pointer"
                >
                  Renommer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL : SUPPRIMER UN DOSSIER --- */}
      {folderToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-red-700 flex items-center gap-2">
                <Trash2 className="w-4 h-4" />
                Supprimer le dossier
              </h3>
              <button
                type="button"
                onClick={() => setFolderToDelete(null)}
                className="p-1 text-[var(--fg-8c8072)] hover:text-[var(--fg-28231d)] rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[var(--fg-695f54)] mb-3">
              Êtes-vous sûr de vouloir supprimer le dossier <strong>« {folderToDelete} »</strong> ?
            </p>
            <p className="text-[11px] text-[var(--fg-8c8072)] mb-4">
              Les documents éventuels qu'il contient ne seront pas supprimés : ils seront automatiquement déplacés vers le dossier parent ou « Général ».
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setFolderToDelete(null)}
                className="px-3 py-1.5 text-xs text-[var(--fg-695f54)] hover:bg-[var(--bg-f3efe8)] rounded-lg cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleDeleteFolderConfirm}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer"
              >
                Supprimer le dossier
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL : DÉPLACER UN DOCUMENT DE DOSSIER --- */}
      {movingDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in">
          <div className="bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-[var(--fg-28231d)] flex items-center gap-2">
                <Move className="w-4 h-4 text-[var(--fg-8c5e32)]" />
                Déplacer le document
              </h3>
              <button
                type="button"
                onClick={() => setMovingDoc(null)}
                className="p-1 text-[var(--fg-8c8072)] hover:text-[var(--fg-28231d)] rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[var(--fg-695f54)] mb-3 line-clamp-2">
              Déplacer <strong>{movingDoc.title}</strong> vers un autre dossier.
            </p>

            <form onSubmit={handleMoveDocSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--fg-4a3e31)] mb-1">
                  Dossier de destination
                </label>
                <select
                  value={targetMoveFolder}
                  onChange={(e) => setTargetMoveFolder(e.target.value)}
                  className="w-full text-xs p-2.5 bg-[var(--bg-faf7f2)] border border-[var(--bd-d5cbbf)] rounded-xl text-[var(--fg-28231d)] focus:outline-none focus:ring-2 focus:ring-[var(--bd-8c5e32)] font-mono"
                >
                  {allFolderPaths.map((f) => (
                    <option key={f} value={f}>
                      📁 {f}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setMovingDoc(null)}
                  className="px-3 py-1.5 text-xs text-[var(--fg-695f54)] hover:bg-[var(--bg-f3efe8)] rounded-lg cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-[var(--bg-8c5e32)] hover:bg-[var(--bg-774d27)] rounded-lg cursor-pointer"
                >
                  Déplacer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
