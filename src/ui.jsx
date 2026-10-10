import React, { useEffect, useRef, useId, createContext, useContext } from 'react';
import { X, AlertCircle } from 'lucide-react';
export const ErrorContext = createContext({ error: '', clearError: () => {} });
export function IconButton({ label, children, ...props }) {
  return (
    <button type="button" className="icon-button" title={label} aria-label={label} {...props}>
      {children}
    </button>
  );
}
export function Modal({ title, children, close, wide = false }) {
  const ref = useRef(null),
    titleId = useId();
  const { error, clearError } = useContext(ErrorContext);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <IconButton label="Fermer fenêtre" onClick={close}>
          <X size={19} />
        </IconButton>
      </header>
      {error && (
        <div className="error-banner modal-error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
          <IconButton label="Fermer erreur dialogue" onClick={clearError}>
            <X size={15} />
          </IconButton>
        </div>
      )}
      {children}
    </dialog>
  );
}
export function Empty({ icon: Icon, title, children }) {
  return (
    <div className="page-empty">
      {Icon && <Icon size={30} />}
      <h2>{title}</h2>
      {children}
    </div>
  );
}
