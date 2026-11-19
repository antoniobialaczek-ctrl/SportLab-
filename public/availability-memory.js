const critical = /^(out|doubtful|inactive|suspended|ruled out)$/i;
const cleared = /^(active|healthy|available|probable|questionable|day.to.day)$/i;
const keyFor = event => JSON.stringify([event.id, event.route, event.homeId, event.awayId, event.date]);
export function createAvailabilityMemory() {
  const fixtures = new Map();
  function current(event, now) {
    if (event?.state !== 'pre' || Date.parse(event.date) <= now) { if (event) fixtures.delete(keyFor(event)); return null; }
    return fixtures.get(keyFor(event)) || null;
  }
  return {
    observe(event, details, { now = Date.now() } = {}) {
      const a = details?.availability, at = Date.parse(a?.fetchedAt), ids = a?.teams?.map(team => team.id) || [];
      if (event?.state !== 'pre' || !(Date.parse(event.date) > now) || !a?.identityVerified || a.eventId !== event.sourceEventId
        || Date.parse(a.startTime) !== Date.parse(event.date) || a.state && a.state !== 'pre'
        || !Number.isFinite(at) || at > now + 60000 || now - at > 15 * 60000
        || ids.length !== 2 || new Set(ids).size !== 2 || !ids.includes(event.homeId) || !ids.includes(event.awayId)) return false;
      const key = keyFor(event), state = fixtures.get(key) || { at: 0, players: new Map() };
      if (at <= state.at) return false;
      for (const team of a.teams) for (const player of team.injuries?.items || []) {
        if (!/^\d{1,14}$/.test(player.id) || typeof player.status !== 'string') continue;
        const status = player.status.trim();
        if (critical.test(status)) state.players.set(player.id, { id: player.id, teamId: team.id, status, observedAt: a.fetchedAt, lastAt: at });
        else if (cleared.test(status)) state.players.delete(player.id);
      }
      state.at = at;
      if (!fixtures.has(key) && fixtures.size >= 200) fixtures.delete(fixtures.keys().next().value);
      fixtures.set(key, state); return true;
    },
    excluded(event, { now = Date.now() } = {}) { return [...(current(event, now)?.players.keys() || [])]; },
    retained(event, { now = Date.now() } = {}) {
      const state = current(event, now);
      return state ? [...state.players.values()].filter(p => p.lastAt !== state.at || now - p.lastAt > 15 * 60000).map(({ lastAt, ...p }) => ({ ...p })) : [];
    },
  };
}
