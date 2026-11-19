import { escapeHTML as esc } from './analysis-view.js';

export function journalPickButtonHTML(event, pick) {
  if (event?.state !== 'pre' || Date.parse(event.date) <= Date.now() || !pick) return '';
  const descriptor = {};
  for (const key of ['kind', 'market', 'side', 'direction', 'scope', 'playerId', 'teamId', 'metric', 'playerName']) {
    if (typeof pick[key] === 'string' && pick[key].length <= (key === 'playerName' ? 200 : 60)) descriptor[key] = pick[key];
  }
  if (typeof pick.line === 'number' && Number.isFinite(pick.line)) descriptor.line = pick.line;
  return `<button type="button" class="pick-save" data-journal-pick="${esc(JSON.stringify(descriptor))}" data-journal-event="${esc(event.id)}">Zapisz własny typ</button>`;
}
