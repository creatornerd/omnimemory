/** The OmniMemory mark, drawn inline so the content script loads no assets. */
export function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flex: 'none' }}>
      <rect width="24" height="24" rx="6" fill="var(--accent)" />
      <circle cx="11" cy="13" r="5" stroke="var(--accent-fg)" strokeWidth="2.2" />
      <circle cx="17.4" cy="6.6" r="2" fill="var(--accent-fg)" />
    </svg>
  );
}
