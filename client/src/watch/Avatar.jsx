import { initials, userColor } from '../shared/lib/format';

export default function Avatar({ name, size = 22 }) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, '--user-color': userColor(name), fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
