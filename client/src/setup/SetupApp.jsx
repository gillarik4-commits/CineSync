import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  ArrowRight,
  Captions,
  Check,
  ChevronDown,
  Clock,
  Film,
  FolderOpen,
  Info,
  Clapperboard,
  X
} from 'lucide-react';
import BlurText from '../shared/components/reactbits/BlurText';
import ShinyText from '../shared/components/reactbits/ShinyText';
import SpotlightCard from '../shared/components/reactbits/SpotlightCard';
import Logo from '../shared/components/Logo';
import FileBrowser from './FileBrowser';
import PermissionList from '../shared/components/PermissionList';
import Switch from '../shared/components/Switch';
import { normalizePermissions } from '../shared/lib/permissions';
import { api } from '../shared/lib/api';
import { basename, dirname, formatDuration } from '../shared/lib/format';
import { readJSON, writeJSON } from '../shared/lib/storage';
import { useSocket } from '../shared/hooks/useSocket';
import { codecName, isImageSubtitle, prettyTrackLabel, videoCompatibilityNote } from './tracks';

const RECENT_KEY = 'cinesync_recent_files';
const PERMS_KEY = 'cinesync_guest_permissions';
const STEPS = ['Choose', 'Tracks', 'Prepare'];

const stepMotion = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] }
};

export default function SetupApp() {
  const [step, setStep] = useState(0);
  const [filePath, setFilePath] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState(null);
  const [media, setMedia] = useState(null);
  const [audio, setAudio] = useState('none');
  const [subtitle, setSubtitle] = useState('none');
  const [externalSub, setExternalSub] = useState('');
  const [playEverywhere, setPlayEverywhere] = useState(false);
  const [prepareError, setPrepareError] = useState(null);
  const [progress, setProgress] = useState(null);
  const [done, setDone] = useState(false);
  const [browser, setBrowser] = useState(null); // null | 'video' | 'subtitle'
  const [guestPerms, setGuestPermsState] = useState(() => normalizePermissions(readJSON(PERMS_KEY, null)));
  const setGuestPerms = (next) => {
    setGuestPermsState(next);
    writeJSON(PERMS_KEY, next);
  };
  const [recent, setRecent] = useState(() => readJSON(RECENT_KEY, []).filter((p) => typeof p === 'string'));
  const stepRef = useRef(step);
  stepRef.current = step;

  useSocket({
    onMessage: (data) => {
      if (data.type === 'TRANSCODE_PROGRESS') {
        const pct = Math.round(Number(data.percent));
        if (Number.isFinite(pct)) setProgress(Math.max(0, Math.min(100, pct)));
      } else if (data.type === 'TRANSCODE_ERROR') {
        if (stepRef.current === 2) {
          setPrepareError(`Couldn't prepare this movie: ${data.message}`);
          setStep(1);
        }
      } else if (data.type === 'TRANSCODE_COMPLETE' || data.type === 'MEDIA_READY') {
        setProgress(100);
        setDone(true);
        window.setTimeout(() => window.location.assign('/watch.html'), 600);
      }
    }
  });

  const rememberRecent = (path) => {
    const next = [path, ...recent.filter((p) => p !== path)].slice(0, 5);
    setRecent(next);
    writeJSON(RECENT_KEY, next);
  };

  const forgetRecent = (path) => {
    const next = recent.filter((p) => p !== path);
    setRecent(next);
    writeJSON(RECENT_KEY, next);
  };

  const inspect = async (path = filePath) => {
    const target = path.trim();
    if (!target) {
      setInspectError('Choose a movie, or paste the full path to one.');
      return;
    }
    setFilePath(target);
    setInspecting(true);
    setInspectError(null);
    try {
      const data = await api('/api/inspect', { method: 'POST', body: { filePath: target } });
      rememberRecent(target);
      setMedia(data);
      setAudio(data.audio?.length ? String(data.audio[0].index) : 'none');
      setSubtitle('none');
      setExternalSub('');
      // Convert by default only when it's needed and a GPU makes it fast.
      setPlayEverywhere(Boolean(data.compat?.recommended && data.compat?.gpu));
      setPrepareError(null);
      setStep(1);
    } catch (err) {
      setInspectError(err.message || "Couldn't read that file. Check the path and try again.");
    } finally {
      setInspecting(false);
    }
  };

  const start = async () => {
    setPrepareError(null);
    setProgress(null);
    setDone(false);
    setStep(2);
    const external = externalSub.trim();
    try {
      await api('/api/prepare', {
        method: 'POST',
        body: {
          filePath,
          audioIndex: audio,
          subIndex: external ? 'external' : subtitle,
          externalSubPath: external || undefined,
          permissions: guestPerms,
          playEverywhere: Boolean(media?.compat?.recommended && playEverywhere)
        }
      });
    } catch (err) {
      setPrepareError(err.message || 'Could not start preparing the movie.');
      setStep(1);
    }
  };

  const changeFile = () => {
    setStep(0);
    setPrepareError(null);
  };

  return (
    <>
      <div className="page-backdrop" aria-hidden="true" />
      <div className="setup">
        <header className="setup-top">
          <Logo />
        </header>

        <main className="setup-main">
          <div className="setup-hero">
            <BlurText
              text="Host a watch party"
              className="setup-title"
              animateBy="words"
              delay={90}
              stepDuration={0.3}
              blur={8}
              distance={14}
              trigger="load"
            />
            <motion.p
              className="setup-lede"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              Pick a movie on this computer. CineSync gets it ready to stream and gives you a link to share.
            </motion.p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            <SpotlightCard
              className="setup-card"
              intensity={0.07}
              borderGlow={0.45}
              spotlightSize={380}
              proximity={120}
              flare={false}
              style={{ '--spotlight-card-surface': 'var(--surface)', '--spotlight-card-shadow': 'var(--shadow-lg)' }}
            >
              <Stepper step={step} done={done} />

              <AnimatePresence mode="wait" initial={false}>
                {step === 0 && (
                  <motion.div key="choose" className="setup-body" {...stepMotion}>
                    <ChooseStep
                      filePath={filePath}
                      setFilePath={setFilePath}
                      inspecting={inspecting}
                      error={inspectError}
                      recent={recent}
                      onBrowse={() => setBrowser('video')}
                      onInspect={inspect}
                      onForget={forgetRecent}
                      clearError={() => setInspectError(null)}
                    />
                  </motion.div>
                )}
                {step === 1 && media && (
                  <motion.div key="tracks" className="setup-body" {...stepMotion}>
                    <TracksStep
                      filePath={filePath}
                      media={media}
                      audio={audio}
                      setAudio={setAudio}
                      subtitle={subtitle}
                      setSubtitle={setSubtitle}
                      externalSub={externalSub}
                      setExternalSub={setExternalSub}
                      error={prepareError}
                      onBrowseSub={() => setBrowser('subtitle')}
                      guestPerms={guestPerms}
                      setGuestPerms={setGuestPerms}
                      playEverywhere={playEverywhere}
                      setPlayEverywhere={setPlayEverywhere}
                      onChangeFile={changeFile}
                      onStart={start}
                    />
                  </motion.div>
                )}
                {step === 2 && (
                  <motion.div key="prepare" className="setup-body" {...stepMotion}>
                    <PrepareStep filePath={filePath} progress={progress} done={done} />
                  </motion.div>
                )}
              </AnimatePresence>
            </SpotlightCard>
          </motion.div>
        </main>

        <footer className="setup-foot">Runs on your computer. Only people with your link can join.</footer>
      </div>

      <FileBrowser
        open={browser !== null}
        kind={browser || 'video'}
        startDir={browser === 'subtitle' ? dirname(externalSub) || dirname(filePath) : dirname(filePath)}
        onClose={() => setBrowser(null)}
        onPick={(path) => {
          if (browser === 'subtitle') setExternalSub(path);
          else inspect(path);
        }}
      />
    </>
  );
}

function Stepper({ step, done }) {
  return (
    <ol className="stepper" aria-label="Setup progress">
      {STEPS.map((label, i) => {
        const state = i < step || (done && i === step) ? 'done' : i === step ? 'current' : 'todo';
        return (
          <li key={label} className={`stepper-item is-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="stepper-dot">{state === 'done' ? <Check size={11} strokeWidth={3} /> : i + 1}</span>
            <span className="stepper-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ChooseStep({ filePath, setFilePath, inspecting, error, recent, onBrowse, onInspect, onForget, clearError }) {
  return (
    <>
      <button type="button" className="pick" onClick={onBrowse} disabled={inspecting}>
        <span className="pick-icon">
          <FolderOpen size={20} strokeWidth={1.6} />
        </span>
        <span className="pick-text">
          <span className="pick-title">Choose a movie</span>
          <span className="pick-sub">Browse folders on this computer</span>
        </span>
        <ArrowRight size={16} className="pick-arrow" />
      </button>

      <div className="divider">
        <span>or paste a path</span>
      </div>

      <form
        className="input-row"
        onSubmit={(e) => {
          e.preventDefault();
          onInspect();
        }}
      >
        <input
          className="input mono"
          type="text"
          value={filePath}
          onChange={(e) => {
            setFilePath(e.target.value);
            if (error) clearError();
          }}
          placeholder="/home/you/Movies/movie.mkv"
          autoComplete="off"
          spellCheck="false"
          aria-label="Movie file path"
        />
        <button type="submit" className="btn btn-secondary" disabled={inspecting || !filePath.trim()}>
          {inspecting ? <span className="spinner spinner-sm" /> : 'Open'}
        </button>
      </form>

      {error && (
        <div className="alert" role="alert">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {recent.length > 0 && (
        <div className="recent">
          <div className="section-label">Recent</div>
          <ul className="recent-list">
            {recent.map((path) => (
              <li key={path} className="recent-item">
                <button
                  type="button"
                  className="recent-open"
                  onClick={() => onInspect(path)}
                  disabled={inspecting}
                  title={path}
                >
                  <Film size={15} />
                  <span className="recent-text">
                    <span className="recent-name">{basename(path)}</span>
                    <span className="recent-dir mono">{dirname(path)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-btn recent-remove"
                  onClick={() => onForget(path)}
                  aria-label={`Remove ${basename(path)} from recent`}
                  title="Remove from recent"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function Select({ value, onChange, children, disabled, id }) {
  return (
    <div className="select-wrap">
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {children}
      </select>
      <ChevronDown size={15} />
    </div>
  );
}

function TracksStep({
  filePath,
  media,
  audio,
  setAudio,
  subtitle,
  setSubtitle,
  externalSub,
  setExternalSub,
  error,
  onBrowseSub,
  onChangeFile,
  onStart,
  guestPerms,
  setGuestPerms,
  playEverywhere,
  setPlayEverywhere
}) {
  const duration = formatDuration(media.duration);
  const usingExternal = externalSub.trim().length > 0;
  const hasAudio = media.audio?.length > 0;

  return (
    <>
      <div className="file-card">
        <span className="file-card-icon">
          <Clapperboard size={18} strokeWidth={1.6} />
        </span>
        <div className="file-card-text">
          <div className="file-card-name" title={filePath}>
            {basename(filePath)}
          </div>
          <div className="file-card-meta">
            {media.videoCodec && media.videoCodec !== 'Unknown' && <span>{codecName(media.videoCodec)}</span>}
            {duration && (
              <span>
                <Clock size={12} /> {duration}
              </span>
            )}
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onChangeFile}>
          Change
        </button>
      </div>

      {media.compat?.recommended && (
        <div className="field">
          <ul className="perm-list">
            <li className="perm-row">
              <label className="perm-text" htmlFor="play-everywhere">
                <span className="perm-label">
                  Play everywhere <span className="optional">· {media.compat.gpu ? `uses your ${media.compat.gpu}` : 'no GPU found'}</span>
                </span>
                <span className="perm-desc">
                  {media.compat.gpu
                    ? `Converts the ${codecName(media.videoCodec)} video to H.264 so it plays in every browser and phone. The room still opens in seconds.`
                    : `Converts the ${codecName(media.videoCodec)} video to H.264 so it plays everywhere. Without a GPU this is slow, so jumping ahead is limited for a while.`}
                </span>
              </label>
              <Switch id="play-everywhere" checked={playEverywhere} onChange={setPlayEverywhere} label="Play everywhere" />
            </li>
          </ul>
          {!playEverywhere && videoCompatibilityNote(media.videoCodec) && (
            <div className="note">
              <Info size={15} />
              <span>{videoCompatibilityNote(media.videoCodec)}</span>
            </div>
          )}
        </div>
      )}

      <div className="field">
        <label className="field-label" htmlFor="audio-track">
          Audio
        </label>
        <Select id="audio-track" value={audio} onChange={setAudio} disabled={!hasAudio}>
          {hasAudio ? (
            media.audio.map((a, i) => (
              <option key={a.index} value={String(a.index)}>
                {prettyTrackLabel(a.label)}
                {media.audio.length > 1 ? ` (track ${i + 1})` : ''}
              </option>
            ))
          ) : (
            <option value="none">No audio track in this file</option>
          )}
        </Select>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="sub-track">
          Subtitles
        </label>
        <Select id="sub-track" value={usingExternal ? 'external' : subtitle} onChange={setSubtitle} disabled={usingExternal}>
          {usingExternal && <option value="external">Using the file below</option>}
          <option value="none">Off</option>
          {media.subtitle?.map((s) => (
            <option key={s.index} value={String(s.index)} disabled={isImageSubtitle(s.label)}>
              {prettyTrackLabel(s.label)}
              {isImageSubtitle(s.label) ? ' (not supported)' : ''}
            </option>
          ))}
        </Select>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="external-sub">
          Subtitle file <span className="optional">· optional</span>
        </label>
        <div className="input-row">
          <input
            id="external-sub"
            className="input mono"
            type="text"
            value={externalSub}
            onChange={(e) => setExternalSub(e.target.value)}
            placeholder="/home/you/Movies/movie.srt"
            autoComplete="off"
            spellCheck="false"
          />
          {usingExternal ? (
            <button type="button" className="btn btn-secondary" onClick={() => setExternalSub('')} aria-label="Clear subtitle file">
              <X size={15} />
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={onBrowseSub}>
              <Captions size={15} />
              Browse
            </button>
          )}
        </div>
        <span className="field-hint">An .srt or .vtt file. It replaces the embedded subtitles.</span>
      </div>

      <div className="field">
        <span className="field-label">What guests can do</span>
        <PermissionList value={guestPerms} onChange={setGuestPerms} idPrefix="setup-perm" />
        <span className="field-hint">You always have full control. You can change these during the movie too.</span>
      </div>

      {error && (
        <div className="alert" role="alert">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      <button type="button" className="btn btn-primary btn-lg btn-block" onClick={onStart}>
        Start watch party
        <ArrowRight size={16} />
      </button>
    </>
  );
}

function PrepareStep({ filePath, progress, done }) {
  const known = progress !== null;
  return (
    <div className="prepare" aria-live="polite">
      <div className="prepare-head">
        <div className="prepare-title">
          {done ? (
            'Ready. Opening the room…'
          ) : (
            <ShinyText text="Getting the first scenes ready" color="#8a8a8a" shineColor="#ffffff" speed={2.2} delay={0.4} />
          )}
        </div>
        <div className="prepare-pct mono">{known ? `${progress}%` : ''}</div>
      </div>
      <div
        className={`progress${known ? '' : ' is-indeterminate'}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? progress : undefined}
        aria-label="Preparing movie"
      >
        <div className="progress-fill" style={known ? { width: `${progress}%` } : undefined} />
      </div>
      <p className="prepare-note">
        <span className="prepare-file" title={filePath}>
          {basename(filePath)}
        </span>
        <br />
        The room opens as soon as the first few seconds are ready. The rest keeps preparing while you watch.
      </p>
    </div>
  );
}
