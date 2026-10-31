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
