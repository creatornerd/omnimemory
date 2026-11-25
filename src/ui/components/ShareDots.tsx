import { SITE_IDS, type Memory } from '../../core';
import { SITES } from '../../shared/sites';

/** One dot per chatbot: filled when the memory is shared with it. */
export function ShareDots({ memory, size = 7 }: { memory: Memory; size?: number }) {
  return (
    <span className="flex gap-[3px]" aria-hidden="true">
      {SITE_IDS.map((site) => {
        const on = memory.enabled && memory.permissions[site];
        return (
          <span
            key={site}
            className="rounded-full border-[1.5px]"
            style={{
              width: size,
              height: size,
              borderColor: SITES[site].color,
              background: on ? SITES[site].color : 'transparent',
            }}
          />
        );
      })}
    </span>
  );
}
