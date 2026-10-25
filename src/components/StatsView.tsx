import React, { useState, useMemo, useRef } from 'react';
import { FolioleStats, DocumentItem, ExtractItem, ClozeItem } from '../types/foliole';
import {
  Download,
  RotateCcw,
  Check,
  Calendar,
  Layers,
  Sparkles,
  BarChart3,
  TrendingUp,
  Upload,
  FolderOpen,
} from 'lucide-react';

interface StatsViewProps {
  stats: FolioleStats;
  documents: DocumentItem[];
  extracts: ExtractItem[];
  clozes: ClozeItem[];
  targetRetention: number;
  onUpdateTargetRetention: (retention: number) => void;
  onExportBackup: () => void;
  onExportMarkdownMirror: () => void;
  onResetDemo: () => Promise<boolean>;
  onRestoreBackup: (file: File) => Promise<{ ok: boolean; message: string }>;
  onOpenDataFolder?: () => void;
  dataLocation?: string;
}

export const StatsView: React.FC<StatsViewProps> = ({
  stats,
  documents,
  extracts,
  clozes,
  targetRetention,
  onUpdateTargetRetention,
  onExportBackup,
  onExportMarkdownMirror,
  onResetDemo,
  onRestoreBackup,
  onOpenDataFolder,
  dataLocation,
}) => {
  const [confirmReset, setConfirmReset] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<File | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [forecastPeriod, setForecastPeriod] = useState<'1d' | '7d' | '30d'>('7d');
  const [hoveredDayIndex, setHoveredDayIndex] = useState<number | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Forecast computation
  const forecastDaysCount = forecastPeriod === '1d' ? 2 : forecastPeriod === '7d' ? 7 : 30;

  const forecastData = useMemo(() => {
    const days: Array<{
      dayIndex: number;
      label: string;
      fullDate: string;
      total: number;
      clozesCount: number;
      extractsCount: number;
      docsCount: number;
    }> = [];

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    for (let i = 0; i < forecastDaysCount; i++) {
      const dayStart = new Date(todayStart.getTime() + i * 86400000);
      const dayEnd = new Date(todayStart.getTime() + (i + 1) * 86400000);

      let clozesCount = 0;
      let extractsCount = 0;
      let docsCount = 0;

      clozes.forEach((c) => {
        if (c.state === 'dismissed') return;
        const reviewDate = c.fsrs?.nextReviewDate ? new Date(c.fsrs.nextReviewDate) : null;
        if (!reviewDate) return;
        if (i === 0) {
          if (reviewDate < dayEnd) clozesCount++;
        } else {
          if (reviewDate >= dayStart && reviewDate < dayEnd) clozesCount++;
        }
      });

      extracts.forEach((e) => {
        if (e.state === 'dismissed') return;
        const reviewDate = e.fsrs?.nextReviewDate ? new Date(e.fsrs.nextReviewDate) : null;
        if (!reviewDate) return;
        if (i === 0) {
          if (reviewDate < dayEnd) extractsCount++;
        } else {
          if (reviewDate >= dayStart && reviewDate < dayEnd) extractsCount++;
        }
      });

      documents.forEach((d) => {
        if (d.state === 'dismissed') return;
        const reviewDate = d.fsrs?.nextReviewDate ? new Date(d.fsrs.nextReviewDate) : null;
        if (!reviewDate) return;
        if (i === 0) {
          if (reviewDate < dayEnd) docsCount++;
        } else {
          if (reviewDate >= dayStart && reviewDate < dayEnd) docsCount++;
        }
      });

      const total = clozesCount + extractsCount + docsCount;
      const label = i === 0 ? 'Auj.' : i === 1 ? '+1 j' : `+${i} j`;
      const fullDate = dayStart.toLocaleDateString('fr-FR', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });

      days.push({
        dayIndex: i,
        label,
        fullDate,
        total,
        clozesCount,
        extractsCount,
        docsCount,
      });
    }

    return days;
  }, [forecastPeriod, forecastDaysCount, clozes, extracts, documents]);

  const totalPeriodReviews = useMemo(() => {
    return forecastData.reduce((acc, d) => acc + d.total, 0);
  }, [forecastData]);

  const maxForecastTotal = useMemo(() => {
    return Math.max(...forecastData.map((d) => d.total), 1);
  }, [forecastData]);

  // Stability buckets (FSRS days until retrievability drops to 70%)
  const stabilityBuckets = useMemo(() => {
    const allItems = [...clozes, ...extracts];
    let b1 = 0; // < 3j
    let b2 = 0; // 3 - 7j
    let b3 = 0; // 7 - 30j
    let b4 = 0; // > 30j

    allItems.forEach((item) => {
      if (item.state === 'dismissed') return;
      const stability = item.fsrs?.stability || 0;
      // In FSRS: R(t) = (1 + t / (9 * S))^-1 => at R=0.70: t = 9 * S * (1/0.70 - 1) ≈ 3.857 * S
      const daysTo70 = stability * 3.857;
      if (daysTo70 < 3) b1++;
      else if (daysTo70 <= 7) b2++;
      else if (daysTo70 <= 30) b3++;
      else b4++;
    });

    const activeTotal = allItems.filter((i) => i.state !== 'dismissed').length;
    const totalDiv = activeTotal || 1;

    return {
      b1,
      b2,
      b3,
      b4,
      pct1: Math.round((b1 / totalDiv) * 100),
      pct2: Math.round((b2 / totalDiv) * 100),
      pct3: Math.round((b3 / totalDiv) * 100),
      pct4: Math.round((b4 / totalDiv) * 100),
      activeTotal,
    };
  }, [clozes, extracts]);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8 pb-6 border-b border-[#E8E2D5]">
        <div>
          <h1 className="text-3xl font-serif font-bold text-[#28231D] tracking-tight">
            Analytique & FSRS
          </h1>
         
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              onExportMarkdownMirror();
              showToast('Miroir Markdown exporté avec succès');
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#4A3E31] bg-white border border-[#D5CBBF] rounded-lg hover:bg-[#F3EFE8] transition-colors shadow-xs"
            title="Exporter tous les extraits et cartes en miroir Markdown"
          >
            <Download className="w-3.5 h-3.5" />
            Miroir Markdown
          </button>
          <button
            onClick={() => {
              onExportBackup();
              showToast('Sauvegarde JSON générée avec succès');
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#4A3E31] bg-white border border-[#D5CBBF] rounded-lg hover:bg-[#F3EFE8] transition-colors shadow-xs"
            title="Exporter l'ensemble de la base Foliole en JSON"
          >
            <Download className="w-3.5 h-3.5" />
            Sauvegarde JSON
          </button>
        </div>
      </div>

      {/* Rangée 1 : Cartes métriques principales */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="p-4 bg-white border border-[#E8E2D5] rounded-2xl shadow-xs">
          <div className="text-[11px] text-[#695F54] uppercase tracking-wider font-semibold">
            Sources & Extraits
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-[#28231D]">
            {stats.totalDocuments + stats.totalExtracts}
          </div>
          <div className="mt-1 text-xs text-[#8C8072]">
            {stats.totalDocuments} doc{stats.totalDocuments > 1 ? 's' : ''} · {stats.totalExtracts} extrait{stats.totalExtracts > 1 ? 's' : ''}
          </div>
        </div>

        <div className="p-4 bg-white border border-[#E8E2D5] rounded-2xl shadow-xs">
          <div className="text-[11px] text-[#695F54] uppercase tracking-wider font-semibold">
            Cartes Cloze Actives
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-[#28231D]">
            {stats.totalClozes}
          </div>
          <div className="mt-1 text-xs text-[#8C8072]">
            Items atomiques (MIP)
          </div>
        </div>

        <div className="p-4 bg-white border border-[#E8E2D5] rounded-2xl shadow-xs">
          <div className="text-[11px] text-[#695F54] uppercase tracking-wider font-semibold">
            Rétention Prédite
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-[#5F8550]">
            {stats.averageRetention}%
          </div>
          <div className="mt-1 text-xs text-[#8C8072]">
            Cible : {Math.round(targetRetention * 100)}%
          </div>
        </div>

        <div className="p-4 bg-white border border-[#E8E2D5] rounded-2xl shadow-xs">
          <div className="text-[11px] text-[#695F54] uppercase tracking-wider font-semibold">
            Révision du jour
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-[#8C5E32]">
            {stats.dueTodayCount}
          </div>
          <div className="mt-1 text-xs text-[#8C8072]">
            {stats.reviewsCompletedToday} terminée{stats.reviewsCompletedToday > 1 ? 's' : ''} aujourd'hui
          </div>
        </div>
      </div>

      {/* Rangée 2 : Format unifié pour Pourcentage cible, Prévision, et Stabilité mémorielle */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* Carte 1 : Pourcentage cible FSRS */}
        <div className="p-4 bg-white border border-[#E8E2D5] rounded-2xl shadow-xs flex flex-col justify-between">
          <div>
            <div className="text-[11px] text-[#695F54] uppercase tracking-wider font-semibold">
              Pourcentage cible FSRS
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-[#8C5E32]">
              {Math.round(targetRetention * 100)}%
            </div>
            <div className="mt-1 text-xs text-[#8C8072]">
              Facteur délai : {(9 * (1 / targetRetention - 1)).toFixed(2)}× S
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-[#F3EFE8]">
            <div className="relative w-full">
              <input
                type="range"
                min={70}
                max={98}
                step={1}
                value={Math.round(targetRetention * 100)}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) {
                    onUpdateTargetRetention(val / 100);
                  }
                }}
                className="w-full h-2 bg-[#F3EFE8] rounded-lg appearance-none cursor-pointer accent-[#8C5E32] block"
              />
              <div className="relative w-full h-6 mt-1.5 select-none">
                {[
                  { val: 70, label: '70%', pct: 0 },
                  { val: 75, label: '75%', pct: 5 / 28 },
                  { val: 80, label: '80%', pct: 10 / 28 },
                  { val: 85, label: '85%', pct: 15 / 28 },
                  { val: 90, label: '90%', pct: 20 / 28, bold: true },
                  { val: 95, label: '95%', pct: 25 / 28 },
                  { val: 98, label: '98%', pct: 1 },
                ].map((m) => {
                  const isSelected = Math.round(targetRetention * 100) === m.val;
                  return (
                    <div
                      key={m.val}
                      style={{
                        left: `calc(8px + (100% - 16px) * ${m.pct})`,
                      }}
                      className="absolute top-0 -translate-x-1/2 flex flex-col items-center"
                    >
                      <span
                        className={`w-0.5 h-1 mb-0.5 transition-colors ${
                          isSelected ? 'bg-[#8C5E32]' : 'bg-[#D5CBBF]'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => onUpdateTargetRetention(m.val / 100)}
                        className={`text-[10px] font-mono transition-colors cursor-pointer hover:text-[#8C5E32] ${
                          isSelected
                            ? 'text-[#8C5E32] font-bold'
                            : m.bold
                            ? 'font-semibold text-[#695F54]'
                            : 'text-[#8C8072]'
                        }`}
                        title={`Définir la rétention cible à ${m.val}%`}
                      >
                        {m.label}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Carte 2 : Prévision des révisions à venir */}
        <div className="p-4 bg-white border border-[#E8E2D5] rounded-2xl shadow-xs flex flex-col justify-between">
          <div>
            <div className="text-[11px] text-[#695F54] uppercase tracking-wider font-semibold">
              Prévision des révisions à venir
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-[#28231D]">
              {totalPeriodReviews}
            </div>
            <div className="mt-1 text-xs text-[#8C8072]">
              {forecastPeriod === '1d'
                ? 'Prochaines 48h (Auj. + Demain)'
                : forecastPeriod === '7d'
                ? 'Sur les 7 prochains jours'
                : 'Sur les 30 prochains jours'}
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-[#F3EFE8] flex gap-1.5">
            <button
              type="button"
              onClick={() => setForecastPeriod('1d')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                forecastPeriod === '1d'
                  ? 'bg-[#3B3026] text-[#FAF7F2] shadow-xs'
                  : 'bg-[#F3EFE8] text-[#695F54] hover:bg-[#E8E2D5]'
              }`}
            >
              1j
            </button>
            <button
              type="button"
              onClick={() => setForecastPeriod('7d')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                forecastPeriod === '7d'
                  ? 'bg-[#3B3026] text-[#FAF7F2] shadow-xs'
                  : 'bg-[#F3EFE8] text-[#695F54] hover:bg-[#E8E2D5]'
              }`}
            >
              7j
            </button>
            <button
              type="button"
              onClick={() => setForecastPeriod('30d')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                forecastPeriod === '30d'
                  ? 'bg-[#3B3026] text-[#FAF7F2] shadow-xs'
                  : 'bg-[#F3EFE8] text-[#695F54] hover:bg-[#E8E2D5]'
              }`}
            >
              30j
            </button>
          </div>
        </div>

        {/* Carte 3 : Courbe de stabilité mémorielle */}
        <div className="p-4 bg-white border border-[#E8E2D5] rounded-2xl shadow-xs flex flex-col justify-between">
          <div>
            <div className="text-[11px] text-[#695F54] uppercase tracking-wider font-semibold">
              Stabilité mémorielle (FSRS)
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-[#5F8550]">
              {stabilityBuckets.pct4}%
            </div>
            <div className="mt-1 text-xs text-[#8C8072]">
              Jours jusqu'à 70% rétention ({stabilityBuckets.b4} items stables &gt;30j)
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-[#F3EFE8] flex flex-col gap-1.5">
            <div className="w-full h-2.5 bg-[#F3EFE8] rounded-full overflow-hidden flex">
              <div
                style={{ width: `${stabilityBuckets.pct1}%` }}
                className="bg-[#D97706] h-full"
                title={`< 3 jours : ${stabilityBuckets.b1} items (${stabilityBuckets.pct1}%)`}
              />
              <div
                style={{ width: `${stabilityBuckets.pct2}%` }}
                className="bg-[#EAB308] h-full"
                title={`3-7 jours : ${stabilityBuckets.b2} items (${stabilityBuckets.pct2}%)`}
              />
              <div
                style={{ width: `${stabilityBuckets.pct3}%` }}
                className="bg-[#84CC16] h-full"
                title={`7-30 jours : ${stabilityBuckets.b3} items (${stabilityBuckets.pct3}%)`}
              />
              <div
                style={{ width: `${stabilityBuckets.pct4}%` }}
                className="bg-[#5F8550] h-full"
                title={`> 30 jours : ${stabilityBuckets.b4} items (${stabilityBuckets.pct4}%)`}
              />
            </div>
            <div className="flex justify-between text-[10px] text-[#8C8072] font-mono">
              <span className="text-[#D97706]">&lt;3j: {stabilityBuckets.b1}</span>
              <span className="text-[#B45309]">3-7j: {stabilityBuckets.b2}</span>
              <span className="text-[#4D7C0F]">7-30j: {stabilityBuckets.b3}</span>
              <span className="text-[#5F8550] font-semibold">&gt;30j: {stabilityBuckets.b4}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Graphique interactif de charge / prévision des révisions */}
      <div className="p-5 bg-white border border-[#E8E2D5] rounded-2xl shadow-xs mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#8C5E32]" />
            <span className="text-sm font-semibold text-[#28231D]">
              Charge de révision journalière ({forecastPeriod === '1d' ? '48 heures' : forecastPeriod === '7d' ? '7 jours' : '30 jours'})
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs text-[#695F54]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#8C5E32]" /> Clozes
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#C4A882]" /> Extraits
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#E8E2D5]" /> Documents
            </span>
          </div>
        </div>

        {/* Zone des barres du graphique */}
        <div className="relative pt-8 pb-2">
          {/* Tooltip au survol */}
          {hoveredDayIndex !== null && forecastData[hoveredDayIndex] && (
            <div className="absolute top-0 left-1/2 -translate-x-1/2 px-3 py-1 bg-[#28231D] text-[#FAF7F2] text-xs rounded-lg shadow-md z-10 pointer-events-none flex items-center gap-3 font-mono">
              <span className="font-sans font-semibold text-[#E8E2D5]">
                {forecastData[hoveredDayIndex].fullDate}
              </span>
              <span>Total : <strong className="text-white">{forecastData[hoveredDayIndex].total}</strong></span>
              <span className="text-[#E8D0BA]">Clozes : {forecastData[hoveredDayIndex].clozesCount}</span>
              <span className="text-[#D5CBBF]">Extraits : {forecastData[hoveredDayIndex].extractsCount}</span>
              <span className="text-[#A89F91]">Docs : {forecastData[hoveredDayIndex].docsCount}</span>
            </div>
          )}

          <div className="h-44 flex items-end gap-1.5 sm:gap-2 px-1 border-b border-[#E8E2D5]">
            {forecastData.map((day, idx) => {
              const heightPercent = maxForecastTotal > 0
                ? Math.max(8, Math.round((day.total / maxForecastTotal) * 100))
                : 8;

              const isHovered = hoveredDayIndex === idx;

              return (
                <div
                  key={day.dayIndex}
                  onMouseEnter={() => setHoveredDayIndex(idx)}
                  onMouseLeave={() => setHoveredDayIndex(null)}
                  className="flex-1 h-full flex flex-col justify-end items-center group cursor-pointer relative"
                >
                  {/* Badge numérique flottant */}
                  <span
                    className={`text-[10px] font-mono tabular-nums mb-1 transition-opacity ${
                      day.total > 0
                        ? isHovered
                          ? 'opacity-100 font-bold text-[#8C5E32]'
                          : 'opacity-70 text-[#695F54]'
                        : 'opacity-0'
                    }`}
                  >
                    {day.total}
                  </span>

                  {/* Barre segmentée ou pleine */}
                  <div
                    style={{ height: `${heightPercent}%` }}
                    className={`w-full max-w-[28px] rounded-t-md transition-all duration-200 flex flex-col-reverse overflow-hidden ${
                      isHovered ? 'ring-2 ring-[#8C5E32] ring-offset-1' : ''
                    } ${day.total === 0 ? 'bg-[#F3EFE8]' : 'bg-[#8C5E32]'}`}
                  >
                    {day.total > 0 && (
                      <>
                        {/* Clozes */}
                        <div
                          style={{
                            height: `${(day.clozesCount / day.total) * 100}%`,
                          }}
                          className="w-full bg-[#8C5E32]"
                        />
                        {/* Extraits */}
                        <div
                          style={{
                            height: `${(day.extractsCount / day.total) * 100}%`,
                          }}
                          className="w-full bg-[#C4A882]"
                        />
                        {/* Documents */}
                        <div
                          style={{
                            height: `${(day.docsCount / day.total) * 100}%`,
                          }}
                          className="w-full bg-[#E8E2D5]"
                        />
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Axe X des libellés */}
          <div className="flex items-center gap-1.5 sm:gap-2 px-1 mt-2">
            {forecastData.map((day, idx) => {
              // Si 30 jours, n'afficher que certains labels pour la lisibilité
              const showLabel =
                forecastPeriod !== '30d' ||
                idx === 0 ||
                idx === 6 ||
                idx === 14 ||
                idx === 21 ||
                idx === 29;

              return (
                <div key={day.dayIndex} className="flex-1 text-center">
                  <span
                    className={`text-[10px] block truncate transition-colors ${
                      hoveredDayIndex === idx
                        ? 'text-[#8C5E32] font-semibold'
                        : 'text-[#8C8072]'
                    }`}
                  >
                    {showLabel ? day.label : '·'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Maintenance et gestion de la base de données */}
      <div className="p-5 bg-white border border-[#E8E2D5] rounded-2xl shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[#28231D]">
              Maintenance de la base de données
            </h2>
            <p className="mt-0.5 text-xs text-[#695F54]">
              Une sauvegarde de sécurité est créée automatiquement avant toute restauration ou réinitialisation.
            </p>
            {dataLocation && (
              <p className="mt-1 text-[11px] text-[#8C8072]">
                Données : <span className="font-mono break-all">{dataLocation}</span> — 7 sauvegardes
                quotidiennes dans « backups »
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onOpenDataFolder && (
              <button
                type="button"
                onClick={onOpenDataFolder}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#4A3E31] bg-white border border-[#D5CBBF] rounded-lg hover:bg-[#F3EFE8] transition-colors shadow-xs"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Ouvrir le dossier des données
              </button>
            )}
            <input
              ref={restoreInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) {
                  setRestoreError(null);
                  setPendingRestore(file);
                }
              }}
            />
            {pendingRestore ? (
              <div className="flex items-center gap-2 p-1.5 bg-[#FAF7F2] border border-[#E8E2D5] rounded-xl">
                <span className="text-xs text-[#A84236] font-medium px-2">
                  Remplacer toute la bibliothèque par « {pendingRestore.name} » ?
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    const file = pendingRestore;
                    setPendingRestore(null);
                    const result = await onRestoreBackup(file);
                    if (result.ok) showToast(result.message);
                    else setRestoreError(result.message);
                  }}
                  className="px-3 py-1 text-xs font-semibold text-white bg-[#A84236] rounded-lg hover:bg-[#8F352B] transition-colors"
                >
                  Oui, restaurer
                </button>
                <button
                  type="button"
                  onClick={() => setPendingRestore(null)}
                  className="px-2.5 py-1 text-xs text-[#695F54] hover:bg-[#E8E2D5] rounded-lg transition-colors"
                >
                  Annuler
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => restoreInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#4A3E31] bg-white border border-[#D5CBBF] rounded-lg hover:bg-[#F3EFE8] transition-colors shadow-xs"
              >
                <Upload className="w-3.5 h-3.5" />
                Restaurer une sauvegarde…
              </button>
            )}
            {confirmReset ? (
              <div className="flex items-center gap-2 p-1.5 bg-[#FAF7F2] border border-[#E8E2D5] rounded-xl">
                <span className="text-xs text-[#A84236] font-medium px-2">
                  Confirmer la réinitialisation ?
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    setConfirmReset(false);
                    if (await onResetDemo()) showToast('Données de démo réinitialisées');
                  }}
                  className="px-3 py-1 text-xs font-semibold text-white bg-[#A84236] rounded-lg hover:bg-[#8F352B] transition-colors"
                >
                  Oui, écraser
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="px-2.5 py-1 text-xs text-[#695F54] hover:bg-[#E8E2D5] rounded-lg transition-colors"
                >
                  Annuler
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#A84236] hover:bg-[#FDF2F0] border border-[#F2D6D3] rounded-lg transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Réinitialiser les données de démo
              </button>
            )}
          </div>
        </div>
        {restoreError && (
          <p role="alert" className="mt-3 text-xs text-[#A84236]">
            Restauration impossible : {restoreError}
          </p>
        )}
      </div>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 bg-[#28231D] text-[#FAF7F2] text-xs font-medium rounded-xl shadow-lg border border-[#3B3026] animate-in fade-in slide-in-from-bottom-2 duration-200">
          <Check className="w-4 h-4 text-[#5F8550]" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
};