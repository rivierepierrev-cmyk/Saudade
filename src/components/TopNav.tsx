import React from 'react';
import { ActiveTab } from '../types/saudade';
import { Plus, BookOpen, Layers, Sparkles, FolderArchive, BarChart2, Sun, Moon, Monitor, Settings } from 'lucide-react';
import { ThemePreference, NEXT_THEME, THEME_LABEL } from '../lib/theme';
import { isMobileApp } from '../lib/platform';

const TABS: Array<{ tab: ActiveTab; label: string; short: string; Icon: typeof Layers; wide?: boolean }> = [
  { tab: 'queue', label: 'File de lecture', short: 'File', Icon: Layers },
  { tab: 'reader', label: 'Lecteur', short: 'Lecteur', Icon: BookOpen },
  { tab: 'review', label: 'Révision du jour', short: 'Révision', Icon: Sparkles },
  { tab: 'library', label: 'Bibliothèque', short: 'Biblio.', Icon: FolderArchive },
  { tab: 'stats', label: 'Statistiques', short: 'Stats', Icon: BarChart2, wide: true },
];

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
    <>
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
        <nav className="hidden md:flex items-center gap-6 sm:gap-8 text-sm font-medium text-[var(--fg-695f54)]">
          {TABS.map(({ tab, label, Icon, wide }) => (
            <button
              key={tab}
              onClick={(e) => {
                // Keys typed next (Space to reveal a card…) must not hit the tab again.
                e.currentTarget.blur();
                onTabChange(tab);
              }}
              aria-current={activeTab === tab ? 'page' : undefined}
              className={`${wide ? 'hidden md:flex' : 'flex'} items-center gap-2 py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
                activeTab === tab
                  ? 'border-[var(--bd-7a4e26)] text-[var(--fg-7a4e26)] font-semibold'
                  : 'border-transparent hover:text-[var(--fg-28231d)]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
              {tab === 'queue' && dueCount > 0 && (
                <span
                  className="text-xs tabular-nums px-1.5 py-0.5 bg-[var(--bg-f3efe8)] border border-[var(--bd-e8e2d5)] rounded text-[var(--fg-5a4f44)]"
                  title={`${dueCount} élément${dueCount > 1 ? 's' : ''} à traiter aujourd'hui`}
                >
                  {dueCount}
                </span>
              )}
            </button>
          ))}
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
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onTabChange('settings');
            }}
            aria-current={activeTab === 'settings' ? 'page' : undefined}
            className={`p-2 rounded-lg transition-colors cursor-pointer ${
              activeTab === 'settings'
                ? 'text-[var(--fg-7a4e26)] bg-[var(--bg-f3efe8)]'
                : 'text-[var(--fg-695f54)] hover:text-[var(--fg-28231d)] hover:bg-[var(--bg-f3efe8)]'
            }`}
            title="Réglages"
            aria-label="Réglages"
          >
            <Settings className="w-4 h-4" />
          </button>
          {!isMobileApp && <button
            onClick={onOpenImport}
            className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-[var(--fg-faf7f2)] bg-[var(--bg-3b3026)] hover:bg-[var(--bg-28211a)] rounded-lg shadow-xs transition-all whitespace-nowrap shrink-0 active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Ajouter une source</span>
          </button>}
        </div>
      </div>
    </header>
      {/* Small screens (the phone app): the tabs at the bottom, under the thumb. Outside the
          header, whose backdrop blur would otherwise contain this fixed bar. */}
      <nav
        aria-label="Navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-5 bg-[var(--bg-ffffff)]/95 backdrop-blur-md border-t border-[var(--bd-e8e2d5)] pb-[env(safe-area-inset-bottom)]"
      >
        {TABS.map(({ tab, label, short, Icon }) => (
          <button
            key={tab}
            onClick={(e) => {
              e.currentTarget.blur();
              onTabChange(tab);
            }}
            aria-current={activeTab === tab ? 'page' : undefined}
            aria-label={label}
            className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] cursor-pointer ${
              activeTab === tab ? 'text-[var(--fg-7a4e26)] font-semibold' : 'text-[var(--fg-695f54)]'
            }`}
          >
            <Icon className="w-5 h-5" />
            {short}
            {tab === 'queue' && dueCount > 0 && (
              <span className="absolute top-1 left-1/2 ml-2 px-1 min-w-4 rounded-full bg-[var(--bg-8c5e32)] text-white text-[10px] leading-4 tabular-nums">
                {dueCount}
              </span>
            )}
          </button>
        ))}
      </nav>
    </>
  );
};
