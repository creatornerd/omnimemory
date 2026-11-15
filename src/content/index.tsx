import { adapterForUrl } from './adapters';
import { mount } from './mount';
import { startMemorySync } from './sync/runner';

/**
 * Content script entry. Runs on the three supported chatbot sites (see the
 * manifest), in the top frame only. It shows the OmniMemory control, and
 * keeps the chatbot's own memory in step with OmniMemory when that is
 * switched on. No page content is read until the user opens the panel.
 */
const adapter = adapterForUrl(window.location.href);
if (adapter && window.top === window) {
  mount(adapter);
  if (adapter.isActive()) startMemorySync(adapter.id);
}
