import React from 'react';
import { ActiveTab } from '../types/gemma';
import { Plus, BookOpen, Layers, Sparkles, FolderArchive, BarChart2 } from 'lucide-react';

interface TopNavProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  dueCount: number;
  onOpenImport: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  activeTab,
  onTabChange,
  dueCount,
  onOpenImport,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-[#E8E2D5] transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-8 h-16">
        {/* Zone 1: Single text element wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-[#3B3026] text-[#FAF7F2] flex items-center justify-center font-bold text-base shadow-xs">
            G
          </div>
          <span className="text-xl font-bold tracking-tight text-[#28231D] whitespace-nowrap shrink-0">
            Gemma
          </span>
        </div>

        {/* Zone 2: Navigation en blanc et beige épuré */}
        <nav className="flex items-center gap-6 sm:gap-8 text-sm font-medium text-[#695F54]">
          <button
            onClick={() => onTabChange('queue')}
            className={`flex items-center gap-2 py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'queue'
                ? 'border-[#7A4E26] text-[#7A4E26] font-semibold'
                : 'border-transparent hover:text-[#28231D]'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>File de lecture</span>
            {dueCount > 0 && (
              <span className="text-xs font-mono tabular-nums px-1.5 py-0.5 bg-[#F3EFE8] border border-[#E8E2D5] rounded text-[#5A4F44]">
                {dueCount}
              </span>
            )}
          </button>

          <button
            onClick={() => onTabChange('reader')}
            className={`flex items-center gap-2 py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'reader'
                ? 'border-[#7A4E26] text-[#7A4E26] font-semibold'
                : 'border-transparent hover:text-[#28231D]'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Lecteur</span>
          </button>

          <button
            onClick={() => onTabChange('review')}
            className={`flex items-center gap-2 py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'review'
                ? 'border-[#7A4E26] text-[#7A4E26] font-semibold'
                : 'border-transparent hover:text-[#28231D]'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Révision du jour</span>
          </button>

          <button
            onClick={() => onTabChange('library')}
            className={`flex items-center gap-2 py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'library'
                ? 'border-[#7A4E26] text-[#7A4E26] font-semibold'
                : 'border-transparent hover:text-[#28231D]'
            }`}
          >
            <FolderArchive className="w-4 h-4" />
            <span>Bibliothèque</span>
          </button>

          <button
            onClick={() => onTabChange('stats')}
            className={`hidden md:flex items-center gap-2 py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'stats'
                ? 'border-[#7A4E26] text-[#7A4E26] font-semibold'
                : 'border-transparent hover:text-[#28231D]'
            }`}
          >
            <BarChart2 className="w-4 h-4" />
            <span>Analytique</span>
          </button>
        </nav>

        {/* Zone 3: 1 action principale */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={onOpenImport}
            className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-[#FAF7F2] bg-[#3B3026] hover:bg-[#28211A] rounded-lg shadow-xs transition-all whitespace-nowrap shrink-0 active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Ajouter une source</span>
          </button>
        </div>
      </div>
    </header>
  );
};
