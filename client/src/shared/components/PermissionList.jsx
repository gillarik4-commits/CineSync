import Switch from './Switch';
import { PERMISSION_OPTIONS } from '../lib/permissions';

/** The guest permission switches, used on the setup page and in room settings. */
export default function PermissionList({ value, onChange, idPrefix = 'perm' }) {
  return (
    <ul className="perm-list">
      {PERMISSION_OPTIONS.map((opt) => (
        <li key={opt.key} className="perm-row">
          <label className="perm-text" htmlFor={`${idPrefix}-${opt.key}`}>
            <span className="perm-label">{opt.label}</span>
            <span className="perm-desc">{opt.desc}</span>
          </label>
          <Switch
            id={`${idPrefix}-${opt.key}`}
            checked={Boolean(value[opt.key])}
            onChange={(on) => onChange({ ...value, [opt.key]: on })}
            label={opt.label}
          />
        </li>
      ))}
    </ul>
  );
}
