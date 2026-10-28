import React, { useState, useMemo } from 'react';
import { SaudadeStats, DocumentItem, ExtractItem, ClozeItem } from '../types/saudade';
import { BarChart3 } from 'lucide-react';

interface StatsViewProps {
  stats: SaudadeStats;
  documents: DocumentItem[];
  extracts: ExtractItem[];
  clozes: ClozeItem[];
  targetRetention: number;
  /** Today's queue by type: the same numbers as the reading queue. */
  today: { documents: number; extracts: number; cards: number };
  /** Leeches among the cards in use. */
  leeches: number;
}

export const StatsView: React.FC<StatsViewProps> = ({
  stats,
  documents,
  extracts,
  clozes,
  targetRetention,
  today,
  leeches,
}) => {
  const [forecastPeriod, setForecastPeriod] = useState<'1d' | '7d' | '30d'>('7d');
  const [hoveredDayIndex, setHoveredDayIndex] = useState<number | null>(null);


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

      // Today: what today's queue holds (daily limit and sibling cards applied).
      if (i === 0) {
        clozesCount = today.cards;
        extractsCount = today.extracts;
        docsCount = today.documents;
      }
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
  }, [forecastPeriod, forecastDaysCount, clozes, extracts, documents, today]);

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

  const tile = (label: string, value: React.ReactNode, sub: React.ReactNode, accent = false) => (
    <div className="p-4 bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-2xl">
      <div className="text-xs text-[var(--fg-695f54)] font-medium">{label}</div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums ${accent ? 'text-[var(--fg-8c5e32)]' : 'text-[var(--fg-28231d)]'}`}>
        {value}
      </div>
      <div className="mt-1 text-xs text-[var(--fg-8c8072)]">{sub}</div>
    </div>
  );
  const toReview = today.extracts + today.cards;
  const newCards = clozes.filter((c) => c.state !== 'dismissed' && c.fsrs.reps === 0).length;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8 pb-6 border-b border-[var(--bd-e8e2d5)]">
        <h1 className="page-title">Statistiques</h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {tile(
          'Aujourd’hui',
          today.documents + toReview,
          `${today.documents} à lire · ${toReview} à réviser · ${stats.reviewsCompletedToday} fait${stats.reviewsCompletedToday > 1 ? 's' : ''}`,
          true
        )}
        {tile(
          'Bibliothèque',
          stats.totalDocuments + stats.totalExtracts,
          `${stats.totalDocuments} document${stats.totalDocuments > 1 ? 's' : ''} · ${stats.totalExtracts} extrait${stats.totalExtracts > 1 ? 's' : ''}`
        )}
        {tile(
          'Cartes',
          stats.totalClozes,
          `dont ${newCards} jamais révisée${newCards > 1 ? 's' : ''}${leeches > 0 ? ` · ${leeches} sangsue${leeches > 1 ? 's' : ''}` : ''}`
        )}
        {tile(
          'Rappel réel (30 j)',
          stats.averageRetention === null ? '—' : `${stats.averageRetention} %`,
          <>
            {stats.averageRetention === null ? 'Pas encore de révision' : `Visé : ${Math.round(targetRetention * 100)} %`}
            {stats.streakDays > 0 && ` · ${stats.streakDays} j d'affilée`}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Carte 2 : À venir */}
        <div className="p-4 bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-2xl shadow-xs flex flex-col justify-between">
          <div>
            <div className="text-[11px] text-[var(--fg-695f54)] uppercase tracking-wider font-semibold">
              À venir
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-[var(--fg-28231d)]">
              {totalPeriodReviews}
            </div>
            <div className="mt-1 text-xs text-[var(--fg-8c8072)]">
              {forecastPeriod === '1d'
                ? 'Aujourd’hui et demain'
                : forecastPeriod === '7d'
                ? 'Sur les 7 prochains jours'
                : 'Sur les 30 prochains jours'}
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-[var(--bd-f3efe8)] flex gap-1.5">
            <button
              type="button"
              onClick={() => setForecastPeriod('1d')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                forecastPeriod === '1d'
                  ? 'bg-[var(--bg-3b3026)] text-[var(--fg-faf7f2)] shadow-xs'
                  : 'bg-[var(--bg-f3efe8)] text-[var(--fg-695f54)] hover:bg-[var(--bg-e8e2d5)]'
              }`}
            >
              2 j
            </button>
            <button
              type="button"
              onClick={() => setForecastPeriod('7d')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                forecastPeriod === '7d'
                  ? 'bg-[var(--bg-3b3026)] text-[var(--fg-faf7f2)] shadow-xs'
                  : 'bg-[var(--bg-f3efe8)] text-[var(--fg-695f54)] hover:bg-[var(--bg-e8e2d5)]'
              }`}
            >
              7 j
            </button>
            <button
              type="button"
              onClick={() => setForecastPeriod('30d')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                forecastPeriod === '30d'
                  ? 'bg-[var(--bg-3b3026)] text-[var(--fg-faf7f2)] shadow-xs'
                  : 'bg-[var(--bg-f3efe8)] text-[var(--fg-695f54)] hover:bg-[var(--bg-e8e2d5)]'
              }`}
            >
              30 j
            </button>
          </div>
        </div>

        {/* Carte 3 : Courbe de stabilité mémorielle */}
        <div className="p-4 bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-2xl shadow-xs flex flex-col justify-between">
          <div>
            <div className="text-[11px] text-[var(--fg-695f54)] uppercase tracking-wider font-semibold">
              Solidité des souvenirs
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-[var(--fg-28231d)]">
              {stabilityBuckets.pct4} %
            </div>
            <div className="mt-1 text-xs text-[var(--fg-8c8072)]">
              tiennent plus d'un mois ({stabilityBuckets.b4} sur {stabilityBuckets.activeTotal}) avant de tomber à 70 % de chances de rappel
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-[var(--bd-f3efe8)] flex flex-col gap-1.5">
            <div className="w-full h-2.5 bg-[var(--bg-f3efe8)] rounded-full overflow-hidden flex">
              <div
                style={{ width: `${stabilityBuckets.pct1}%` }}
                className="bg-[var(--bg-d97706)] h-full"
                title={`< 3 jours : ${stabilityBuckets.b1} éléments (${stabilityBuckets.pct1}%)`}
              />
              <div
                style={{ width: `${stabilityBuckets.pct2}%` }}
                className="bg-[var(--bg-eab308)] h-full"
                title={`3-7 jours : ${stabilityBuckets.b2} éléments (${stabilityBuckets.pct2}%)`}
              />
              <div
                style={{ width: `${stabilityBuckets.pct3}%` }}
                className="bg-[var(--bg-84cc16)] h-full"
                title={`7-30 jours : ${stabilityBuckets.b3} éléments (${stabilityBuckets.pct3}%)`}
              />
              <div
                style={{ width: `${stabilityBuckets.pct4}%` }}
                className="bg-[var(--bg-5f8550)] h-full"
                title={`> 30 jours : ${stabilityBuckets.b4} éléments (${stabilityBuckets.pct4}%)`}
              />
            </div>
            <div className="flex justify-between text-[10px] text-[var(--fg-8c8072)] ">
              <span className="text-[var(--fg-d97706)]">&lt;3j: {stabilityBuckets.b1}</span>
              <span className="text-[var(--fg-b45309)]">3-7j: {stabilityBuckets.b2}</span>
              <span className="text-[var(--fg-4d7c0f)]">7-30j: {stabilityBuckets.b3}</span>
              <span className="text-[var(--fg-5f8550)] font-semibold">&gt;30j: {stabilityBuckets.b4}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Graphique interactif de charge / prévision des révisions */}
      <div className="p-5 bg-[var(--bg-ffffff)] border border-[var(--bd-e8e2d5)] rounded-2xl shadow-xs mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[var(--fg-8c5e32)]" />
            <span className="text-sm font-semibold text-[var(--fg-28231d)]">
              Charge à venir ({forecastPeriod === '1d' ? '48 heures' : forecastPeriod === '7d' ? '7 jours' : '30 jours'})
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs text-[var(--fg-695f54)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[var(--chart-clozes)]" /> Cartes
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[var(--chart-extracts)]" /> Extraits
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[var(--chart-docs)]" /> Documents
            </span>
          </div>
        </div>

        {/* Zone des barres du graphique */}
        <div className="relative pt-8 pb-2">
          {/* Tooltip au survol */}
          {hoveredDayIndex !== null && forecastData[hoveredDayIndex] && (
            <div className="absolute top-0 left-1/2 -translate-x-1/2 px-3 py-1 bg-[var(--bg-28231d)] text-[var(--fg-faf7f2)] text-xs rounded-lg shadow-md z-10 pointer-events-none flex items-center gap-3 font-mono">
              <span className="font-sans font-semibold text-[var(--fg-e8e2d5)]">
                {forecastData[hoveredDayIndex].fullDate}
              </span>
              <span>Total : <strong className="text-white">{forecastData[hoveredDayIndex].total}</strong></span>
              <span className="text-[var(--fg-e8d0ba)]">Cartes : {forecastData[hoveredDayIndex].clozesCount}</span>
              <span className="text-[var(--fg-d5cbbf)]">Extraits : {forecastData[hoveredDayIndex].extractsCount}</span>
              <span className="text-[var(--fg-a89f91)]">Docs : {forecastData[hoveredDayIndex].docsCount}</span>
            </div>
          )}

          <div className="h-44 flex items-end gap-1.5 sm:gap-2 px-1 border-b border-[var(--bd-e8e2d5)]">
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
                          ? 'opacity-100 font-bold text-[var(--fg-8c5e32)]'
                          : 'opacity-70 text-[var(--fg-695f54)]'
                        : 'opacity-0'
                    }`}
                  >
                    {day.total}
                  </span>

                  {/* Barre segmentée ou pleine */}
                  <div
                    style={{ height: `${heightPercent}%` }}
                    className={`w-full max-w-[28px] rounded-t-md transition-all duration-200 flex flex-col-reverse overflow-hidden ${
                      isHovered ? 'ring-2 ring-[var(--bd-8c5e32)] ring-offset-1' : ''
                    } ${day.total === 0 ? 'bg-[var(--bg-f3efe8)]' : 'bg-[var(--bg-8c5e32)]'}`}
                  >
                    {day.total > 0 && (
                      <>
                        {/* Clozes */}
                        <div
                          style={{
                            height: `${(day.clozesCount / day.total) * 100}%`,
                          }}
                          className="w-full bg-[var(--chart-clozes)] border-b border-[var(--bg-ffffff)]"
                        />
                        {/* Extraits */}
                        <div
                          style={{
                            height: `${(day.extractsCount / day.total) * 100}%`,
                          }}
                          className="w-full bg-[var(--chart-extracts)] border-b border-[var(--bg-ffffff)]"
                        />
                        {/* Documents */}
                        <div
                          style={{
                            height: `${(day.docsCount / day.total) * 100}%`,
                          }}
                          className="w-full bg-[var(--chart-docs)]"
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
                        ? 'text-[var(--fg-8c5e32)] font-semibold'
                        : 'text-[var(--fg-8c8072)]'
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

    </div>
  );
};
