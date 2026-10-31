export const DAY_NAMES = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

/** 175 → '2 h 55', 55 → '55 min', 120 → '2 h' (with non-breaking spaces). */
export function duration(mins: number): string {
  const m = Math.round(mins);
  if (m < 60) return `${m}\u00a0min`;
  const rest = m % 60;
  return `${Math.floor(m / 60)}\u00a0h${rest ? `\u00a0${String(rest).padStart(2, '0')}` : ''}`;
}

/** 2.5 → '2,5' */
export const number = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

export const plural = (n: number, word: string, many = `${word}s`) => `${number(n)}\u00a0${n >= 2 ? many : word}`;

const fmt = (options: Intl.DateTimeFormatOptions) => {
  const f = new Intl.DateTimeFormat('fr-FR', { ...options, timeZone: 'UTC' });
  return (d: string) => f.format(new Date(`${d}T00:00:00Z`));
};

/** 'jeudi 9 octobre 2025' */
export const longDate = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
/** 'jeudi 9 octobre' */
export const longDay = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
/** 'jeu. 9 oct.' */
export const shortDay = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
/** '9 oct.' */
export const shortDate = fmt({ day: 'numeric', month: 'short' });
/** 'octobre 2025' */
export const monthLabel = fmt({ month: 'long', year: 'numeric' });
