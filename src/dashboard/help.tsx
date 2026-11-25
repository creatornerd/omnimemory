import type { ReactNode } from 'react';
import { SHARED_DAILY_LIMIT, TRASH_RETENTION_DAYS } from '../core';
import { HelpTip } from '../ui/components/HelpTip';

/**
 * What each part of the dashboard does, in plain words. Shown by the small ⓘ
 * next to that part. Kept in one place so the wording stays consistent.
 */
const HELP = {
  'home.search': {
    title: 'Search',
    body: 'Finds memories by their words. It forgives small typos and knows a few similar words, so “concise” also finds “short answers”. Press Enter to see the results on the Memories page.',
  },
  'home.needs': {
    title: 'Needs you',
    body: 'Things waiting for your decision: changes OmniMemory won’t make to a chatbot without your OK, and facts found on your chatbots that you can choose to keep.',
  },
  'home.chatbots': {
    title: 'Chatbots',
    body: 'One card per chatbot: whether sync is on, when it last ran, and how much of that chatbot’s memory space OmniMemory is using. “Manage sync” opens the full details.',
  },
  'home.recent': {
    title: 'Recently used',
    body: 'The memories you added to a chat most recently. The coloured dots show which chatbots can use each one.',
  },
  'home.categories': {
    title: 'Categories',
    body: 'OmniMemory sorts each memory into a category when you save it. Click one to see just those memories. You can change a memory’s category at any time.',
  },
  'home.sources': {
    title: 'Where they came from',
    body: 'Where each memory was first saved: on a chatbot’s page, typed in here, imported from a file, or kept from the Review page.',
  },
  'library.page': {
    title: 'Memories',
    body: 'Everything you’ve saved. Click a memory’s text to edit it. The sharing button on each row chooses which chatbots can see it. Tick rows to change or delete several at once.',
  },
  'library.filters': {
    title: 'Filters',
    body: 'Narrow the list to one category, or to memories shared with a particular chatbot, kept private, or saved in a particular place.',
  },
  'review.page': {
    title: 'Review',
    body: 'When sync reads what a chatbot remembers, anything OmniMemory doesn’t have yet shows up here. Ticked items become memories when you press Keep. Unticked ones are skipped and won’t be suggested again. The same fact found on several chatbots is shown once.',
  },
  'chatbots.page': {
    title: 'Chatbot sync',
    body: 'Sync keeps each chatbot’s own memory settings in step with OmniMemory. It only writes memories shared with that chatbot, in a clearly marked section, and asks before its first write and before removing anything it didn’t add.',
  },
  'chatbots.writes': {
    title: 'Where it writes',
    body: 'The exact place in the chatbot’s settings that OmniMemory edits. Anything else you wrote there is left untouched. The “reads” part is only read, and anything new from it is offered on the Review page.',
  },
  'chatbots.space': {
    title: 'Space used',
    body: 'Some chatbots limit how much text their memory settings hold (ChatGPT’s custom instructions hold 1,500 characters). If your memories don’t all fit, the most recently used ones are kept and the rest wait.',
  },
  'chatbots.approvals': {
    title: 'Changes waiting for your OK',
    body: 'OmniMemory asks first before it writes to a chatbot for the first time, before it links an entry the chatbot already had, and before it removes something it didn’t put there. Nothing happens until you answer.',
  },
  'chatbots.activity': {
    title: 'Activity',
    body: 'Every change sync made, newest first. Undo puts things back: it changes your memory in OmniMemory, and the next sync brings the chatbot in line.',
  },
  'assistant.page': {
    title: 'Assistant',
    body: `Ask in plain words to add, change or remove memories, even several at once. It shows each change with a tick box, and nothing changes until you press Apply. It uses Gemini: ${SHARED_DAILY_LIMIT} free actions a day, or unlimited with your own key. Private memories are never sent.`,
  },
  'trash.page': {
    title: 'Recently deleted',
    body: `Deleted memories stay here for ${TRASH_RETENTION_DAYS} days, then are removed for good. Restore brings one back exactly as it was, including who it was shared with.`,
  },
  'settings.sharing': {
    title: 'Sharing switches',
    body: 'Master switches that sit above every memory’s own sharing. Pausing stops chatbots from receiving anything without changing or deleting a single memory.',
  },
  'settings.new': {
    title: 'New memories',
    body: 'Who a memory is shared with when you first save it here in the dashboard. You can change it for each memory later.',
  },
  'settings.source': {
    title: 'Memories saved on a chatbot',
    body: 'Separate rules for memories saved from the in-chat panel or brought in from a chatbot. For example, keep things saved on ChatGPT off Claude. The panel still shows the choice every time you save.',
  },
  'settings.appearance': {
    title: 'Appearance',
    body: 'Light or dark mode, and the colour used for each chatbot everywhere in OmniMemory: the dots, cards and the in-chat panel.',
  },
  'sidebar.sharing': {
    title: 'Sharing at a glance',
    body: 'Which chatbots can receive your memories right now. Open Settings to pause sharing everywhere or with one chatbot.',
  },
} satisfies Record<string, { title: string; body: ReactNode }>;

export type HelpId = keyof typeof HELP;

/** The ⓘ for one part of the dashboard. */
export function Help({ id, className }: { id: HelpId; className?: string }) {
  const { title, body } = HELP[id];
  return (
    <HelpTip title={title} className={className}>
      {body}
    </HelpTip>
  );
}
