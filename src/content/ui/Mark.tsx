/**
 * The OmniMemory mark, drawn inline so the content script loads no assets.
 * Two overlapping rings; the blue middle is what OmniMemory passes between
 * your AI and your memory.
 */
export function Mark({ size = 18 }: { size?: number }) {
  const stroke = size <= 16 ? 1.9 : 1.8;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flex: 'none' }}>
      <rect width="24" height="24" rx="6.5" fill="var(--logo-bg)" />
      <path d="M12 7.62A5.2 5.2 0 0 1 12 16.38A5.2 5.2 0 0 1 12 7.62Z" fill="var(--brand)" />
      <circle cx="9.2" cy="12" r="5.2" stroke="var(--logo-ring)" strokeWidth={stroke} />
      <circle cx="14.8" cy="12" r="5.2" stroke="var(--logo-ring)" strokeWidth={stroke} />
    </svg>
  );
}
