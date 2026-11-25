import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ShieldCheck } from 'lucide-react';
import PermissionList from '../shared/components/PermissionList';

/** Host-only popover to change what guests can do, live. */
export default function RoomSettings({ permissions, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const restricted = Object.values(permissions).filter((v) => !v).length;

  return (
    <div className="room-settings" ref={ref}>
      <button
        type="button"
        className="pill-btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="What guests can do"
      >
        <ShieldCheck size={14} />
        <span className="room-settings-label">Host</span>
        {restricted > 0 && <span className="room-settings-count">{restricted} off</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="menu room-settings-menu"
            role="dialog"
            aria-label="What guests can do"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
          >
            <div className="menu-label">What guests can do</div>
            <PermissionList value={permissions} onChange={onChange} idPrefix="room-perm" />
            <p className="room-settings-note">You’re the host, so you can always do everything.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
