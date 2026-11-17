import type { Memory, RepeatMatch, Settings } from '../../core';
import { getAssistant } from '../../shared/platform';

/** The AI repeat check for MemoryForm, or undefined when the assistant is off. */
export function repeatCheck(
  settings: Settings,
  library: Memory[],
  editingId?: string,
): ((text: string) => Promise<RepeatMatch[]>) | undefined {
  const assistant = getAssistant(settings);
  if (!assistant) return undefined;
  return (text) => assistant.checkRepeat(text, library, editingId);
}
