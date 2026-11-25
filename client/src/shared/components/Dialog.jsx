import { useEffect, useId, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal: Esc and backdrop click close it, focus moves inside on open,
 * Tab is kept inside, and focus returns to the opener on close.
 */
export default function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className = '',
  initialFocus,
  hideClose = false,
  dismissible = true
}) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef(null);
  const returnFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement;
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = (initialFocus && panel.querySelector(initialFocus)) || panel.querySelector(FOCUSABLE) || panel;
      target.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      const el = returnFocusRef.current;
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus();
    };
  }, [open, initialFocus]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape' && dismissible) {
      e.stopPropagation();
      onClose?.();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = Array.from(panelRef.current?.querySelectorAll(FOCUSABLE) || []);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="dialog-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onMouseDown={(e) => {
            if (dismissible && e.target === e.currentTarget) onClose?.();
          }}
          onKeyDown={onKeyDown}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-describedby={description ? descId : undefined}
            tabIndex={-1}
            className={`dialog ${className}`}
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {(title || !hideClose) && (
              <div className="dialog-header">
                <div>
                  {title && (
                    <h2 id={titleId} className="dialog-title">
                      {title}
                    </h2>
                  )}
                  {description && (
                    <p id={descId} className="dialog-desc">
                      {description}
                    </p>
                  )}
                </div>
                {!hideClose && (
                  <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
                    <X size={16} />
                  </button>
                )}
              </div>
            )}
            {children}
            {footer && <div className="dialog-footer">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
