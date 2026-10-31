import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  className?: string;
}

/** A modal window. Mount it to open it; Escape calls `onClose`. */
export function Window({ title, subtitle, children, footer, onClose, className }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  return (
    <dialog ref={dialog} className={`window${className ? ` ${className}` : ''}`} aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <header className="window-head">
        <h2 id={titleId}>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </header>
      <div className="window-body">{children}</div>
      <footer className="window-foot">{footer}</footer>
    </dialog>
  );
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
