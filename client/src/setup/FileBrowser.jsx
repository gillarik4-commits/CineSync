import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Captions, Film, Folder, SearchIcon } from 'lucide-react';
import Dialog from '../shared/components/Dialog';
import { api } from '../shared/lib/api';
import { formatSize } from '../shared/lib/format';
import { readStorage, writeStorage } from '../shared/lib/storage';

/**
 * Browses folders on the host machine through /api/browse (host-only on the server).
 * kind: 'video' | 'subtitle'. Calls onPick(absolutePath) when a file is chosen.
 */
export default function FileBrowser({ open, kind = 'video', startDir, onPick, onClose }) {
  const [listing, setListing] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const requestRef = useRef(0);
  const listRef = useRef(null);
  const filterRef = useRef(null);
  const storageKey = `cinesync_browse_dir_${kind}`;

  const load = useCallback(
    async (dir, { fallbackToHome = false } = {}) => {
      const id = ++requestRef.current;
      setLoading(true);
      setError(null);
      setFilter('');
      try {
        const data = await api('/api/browse', { query: dir ? { kind, dir } : { kind } });
        if (id !== requestRef.current) return;
        setListing(data);
        writeStorage(storageKey, data.path);
        filterRef.current?.focus();
      } catch (err) {
        if (id !== requestRef.current) return;
        if (fallbackToHome && dir && err.status !== 403) {
          load(null);
          return;
        }
        setError(err.message);
      } finally {
        if (id === requestRef.current) setLoading(false);
      }
    },
    [kind, storageKey]
  );

  useEffect(() => {
    if (!open) return;
    setListing(null);
    load(startDir || readStorage(storageKey), { fallbackToHome: true });
    return () => {
      requestRef.current++;
    };
  }, [open, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const entries = useMemo(() => {
    const all = listing?.entries || [];
    const q = filter.trim().toLowerCase();
    return q ? all.filter((e) => e.name.toLowerCase().includes(q)) : all;
  }, [listing, filter]);

  const fileCount = listing ? listing.entries.filter((e) => e.type === 'file').length : 0;
  const dirCount = listing ? listing.entries.length - fileCount : 0;
  const noun = kind === 'subtitle' ? 'subtitle file' : 'video';

  const choose = (entry) => {
    if (entry.type === 'dir') {
      load(entry.path);
    } else {
      onPick(entry.path);
      onClose();
    }
  };

  const goUp = () => listing?.parent && load(listing.parent);

  const onKeyDown = (e) => {
    const items = Array.from(listRef.current?.querySelectorAll('.fb-item') || []);
    const index = items.indexOf(document.activeElement);
    const inFilter = document.activeElement === filterRef.current;

    if (e.key === 'Backspace' && (!inFilter || filter === '')) {
      e.preventDefault();
      goUp();
    } else if (e.key === 'ArrowDown' && items.length) {
      e.preventDefault();
      items[Math.min(index + 1, items.length - 1)].focus();
    } else if (e.key === 'ArrowUp' && items.length) {
      e.preventDefault();
      if (index <= 0) filterRef.current?.focus();
      else items[index - 1].focus();
    } else if (e.key === 'Enter' && inFilter && entries.length) {
      e.preventDefault();
      choose(entries[0]);
    }
  };

  const FileIcon = kind === 'subtitle' ? Captions : Film;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={kind === 'subtitle' ? 'Choose a subtitle file' : 'Choose a movie'}
      className="fb-dialog"
      initialFocus=".fb-filter input"
    >
      <div className="fb" onKeyDown={onKeyDown}>
        {listing?.places?.length > 0 && (
          <div className="fb-places" role="group" aria-label="Locations">
            {listing.places.map((place) => (
              <button
                key={place.path}
                type="button"
                className={`fb-place${place.path === listing.path ? ' is-active' : ''}`}
                title={place.path}
                onClick={() => load(place.path)}
              >
                {place.label}
              </button>
            ))}
          </div>
        )}

        <div className="fb-toolbar">
          <button
            type="button"
            className="icon-btn fb-up"
            onClick={goUp}
            disabled={!listing?.parent}
            aria-label="Up one folder"
            title="Up one folder (Backspace)"
          >
            <ArrowUp size={16} />
          </button>
          <div className="fb-path mono" title={listing?.path || ''}>
            <bdi dir="ltr">{listing?.path || ' '}</bdi>
          </div>
        </div>

        <label className="fb-filter">
          <SearchIcon size={14} aria-hidden="true" />
          <input
            ref={filterRef}
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter this folder"
            autoComplete="off"
            spellCheck="false"
            aria-label="Filter this folder"
          />
        </label>

        <div className="fb-list" ref={listRef} role="listbox" aria-label="Folder contents" aria-busy={loading}>
          {error ? (
            <div className="fb-empty is-error">
              <p>{error}</p>
              <p className="fb-empty-sub">You can still paste the full path into the field instead.</p>
            </div>
          ) : !listing ? (
            <div className="fb-empty">
              <div className="spinner" />
            </div>
          ) : entries.length === 0 ? (
            <div className="fb-empty">
              <p>{filter ? 'Nothing matches that filter' : `No folders or ${noun}s here`}</p>
            </div>
          ) : (
            entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                role="option"
                aria-selected="false"
                className={`fb-item${entry.type === 'file' ? ' is-file' : ''}`}
                title={entry.path}
                onClick={() => choose(entry)}
              >
                {entry.type === 'dir' ? <Folder size={16} /> : <FileIcon size={16} />}
                <span className="fb-item-name">{entry.name}</span>
                {entry.type === 'file' && <span className="fb-item-meta mono">{formatSize(entry.size)}</span>}
              </button>
            ))
          )}
        </div>

        <div className="fb-footer">
          <span>
            {listing && !error
              ? `${dirCount} folder${dirCount === 1 ? '' : 's'} · ${fileCount} ${noun}${fileCount === 1 ? '' : 's'}`
              : ' '}
          </span>
          <span className="fb-keys">
            <span className="kbd">↑↓</span> move <span className="kbd">↵</span> open <span className="kbd">⌫</span> up
          </span>
        </div>
      </div>
    </Dialog>
  );
}
