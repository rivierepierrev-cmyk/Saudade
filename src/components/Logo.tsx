import React, { useId } from 'react';

/** Saudade's logo (a sprout growing from an open book), same drawing as build/logo.svg. */
export const Logo: React.FC<{ className?: string }> = ({ className }) => {
  const u = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${u}disc`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#DCEBC9" />
          <stop offset="1" stopColor="#BFD9A3" />
        </linearGradient>
        <linearGradient id={`${u}bud`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9BC653" />
          <stop offset="1" stopColor="#3E8A3A" />
        </linearGradient>
        <linearGradient id={`${u}leafL`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2E7A3B" />
          <stop offset="1" stopColor="#16543A" />
        </linearGradient>
        <linearGradient id={`${u}leafR`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5A9E3E" />
          <stop offset="1" stopColor="#1F633A" />
        </linearGradient>
        <linearGradient id={`${u}sheetL`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2E7A3B" />
          <stop offset="1" stopColor="#8CC05A" />
        </linearGradient>
        <linearGradient id={`${u}sheetR`} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#2E7A3B" />
          <stop offset="1" stopColor="#8CC05A" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="46" r="37" fill={`url(#${u}disc)`} />
      <path d="M48.5 70 C 46 56, 38 45, 22 40 C 24 54, 33 62, 48.5 70 Z" fill={`url(#${u}leafL)`} />
      <path d="M51.5 70 C 54 56, 62 45, 78 40 C 76 54, 67 62, 51.5 70 Z" fill={`url(#${u}leafR)`} />
      <path d="M50 74 C 49 62, 48 54, 50 44" fill="none" stroke="#16543A" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M50 46 C 40 40, 39 26, 52 10 C 62 24, 60 40, 50 46 Z" fill={`url(#${u}bud)`} />
      <path d="M50 46 C 54 36, 55 24, 52 10 C 62 24, 60 40, 50 46 Z" fill="#2F7A3A" opacity="0.55" />
      <path d="M50 74 C 41 64, 29 59, 14 58.5 L 11.5 63 C 27 63.5, 40 67.5, 50 76 Z" fill={`url(#${u}sheetL)`} />
      <path d="M50 74 C 59 64, 71 59, 86 58.5 L 88.5 63 C 73 63.5, 60 67.5, 50 76 Z" fill={`url(#${u}sheetR)`} />
      <path d="M50 77 C 39 69, 25 66, 8 66 L 15 79 C 30 79, 42 82, 50 89 Z" fill="#0F4A32" stroke="#0F4A32" strokeWidth="2" strokeLinejoin="round" />
      <path d="M50 77 C 61 69, 75 66, 92 66 L 85 79 C 70 79, 58 82, 50 89 Z" fill="#17603E" stroke="#17603E" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
};
