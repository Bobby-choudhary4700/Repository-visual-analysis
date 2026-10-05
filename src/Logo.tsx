/** Three connected nodes, matching the app icon. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M8.5 10 L23.5 10 L16 23.5 Z"
        fill="none"
        stroke="#38bdf8"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <circle cx="8.5" cy="10" r="3.8" fill="#38bdf8" />
      <circle cx="23.5" cy="10" r="3.8" fill="#38bdf8" />
      <circle cx="16" cy="23.5" r="3.8" fill="#f472b6" />
    </svg>
  );
}
