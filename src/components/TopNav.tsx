import React from 'react';
import { ActiveTab } from '../types/saudade';
import { Plus, BookOpen, Layers, Sparkles, FolderArchive, BarChart2, Sun, Moon, Monitor } from 'lucide-react';
import { ThemePreference, NEXT_THEME, THEME_LABEL } from '../lib/theme';

interface TopNavProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  dueCount: number;
  onOpenImport: () => void;
  theme: ThemePreference;
  onChangeTheme: (theme: ThemePreference) => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  activeTab,
  onTabChange,
  dueCount,
  onOpenImport,
  theme,
  onChangeTheme,
}) => {
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return (
    <header className="sticky top-0 z-40 bg-[var(--bg-ffffff)]/95 backdrop-blur-md border-b border-[var(--bd-e8e2d5)] transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-8 h-16">
        {/* Zone 1: Single text element wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-[var(--bg-3b3026)] text-[var(--fg-faf7f2)] flex items-center justify-center font-bold text-base shadow-xs">
            S
          </div>
          <span className="text-xl font-bold tracking-tight text-[var(--fg-28231d)] whitespace-nowrap shrink-0">
            Saudade
          </span>
        </div>

        {/* Zone 2: Navigation en blanc et beige épuré */}
        <nav className="flex items-center gap-6 sm:gap-8 text-sm font-medium text-[var(--fg-695f54)]">
          <button
            onClick={() => onTabChange('queue')}
            className={`flex items-center gap-2 py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'queue'
                ? 'border-[var(--bd-7a4e26)] text-[var(--fg-7a4e26)] font-semibold'
                : 'border-transparent hover:text-[var(--fg-28231d)]'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>File de lecture</span>
            {dueCount > 0 && (
              <span className="text-xs font-mono tabular-nums px-1.5 py-0.5 bg-[var(--bg-f3efe8)] border border-[var(--bd-e8e2d5)] rounded text-[var(--fg-5a4f44)]">
                {dueCount}
              </span>
            )}
          </button>

          <button
            onClick={() => onTabChange('reader')}
            className={`flex items-center gap-2 py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'reader'
                ? 'border-[var(--bd-7a4e26)] text-[var(--fg-7a4e26)] font-semibold'
                : 'border-transparent hover:text-[var(--fg-28231d)]'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Lecteur</span>
          </button>

          <button
            onClick={() => onTabChange('review')}
            className={`flex items-center gap-2 py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'review'
                ? 'border-[var(--bd-7a4e26)] text-[var(--fg-7a4e26)] font-semibold'
                : 'border-transparent hover:text-[var(--fg-28231d)]'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Révision du jour</span>
          </button>

          <button
            onClick={() => onTabChange('library')}
            className={`flex items-center gap-2 py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'library'
                ? 'border-[var(--bd-7a4e26)] text-[var(--fg-7a4e26)] font-semibold'
                : 'border-transparent hover:text-[var(--fg-28231d)]'
            }`}
          >
            <FolderArchive className="w-4 h-4" />
            <span>Bibliothèque</span>
          </button>

          <button
            onClick={() => onTabChange('stats')}
            className={`hidden md:flex items-center gap-2 py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'stats'
                ? 'border-[var(--bd-7a4e26)] text-[var(--fg-7a4e26)] font-semibold'
                : 'border-transparent hover:text-[var(--fg-28231d)]'
            }`}
          >
            <BarChart2 className="w-4 h-4" />
            <span>Analytique</span>
          </button>
        </nav>

        {/* Zone 3: 1 action principale */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onChangeTheme(NEXT_THEME[theme])}
            className="p-2 rounded-lg text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] hover:bg-[var(--bg-f3efe8)] transition-colors cursor-pointer"
            title={`${THEME_LABEL[theme]} (cliquer pour changer)`}
            aria-label={THEME_LABEL[theme]}
          >
            <ThemeIcon className="w-4 h-4" />
          </button>
          <button
            onClick={onOpenImport}
            className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-[var(--fg-faf7f2)] bg-[var(--bg-3b3026)] hover:bg-[var(--bg-28211a)] rounded-lg shadow-xs transition-all whitespace-nowrap shrink-0 active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Ajouter une source</span>
          </button>
        </div>
      </div>
    </header>
  );
};
