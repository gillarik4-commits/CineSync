export function LogoMark({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.75" y="2.75" width="18.5" height="18.5" rx="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M9.75 8.4v7.2a.55.55 0 0 0 .84.47l5.65-3.6a.55.55 0 0 0 0-.94l-5.65-3.6a.55.55 0 0 0-.84.47z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function Logo({ size = 22, className = '' }) {
  return (
    <span className={`logo ${className}`}>
      <LogoMark size={size} />
      <span className="logo-word">CineSync</span>
    </span>
  );
}
