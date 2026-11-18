import { clamp, eloProbability } from './utils.js';

export const nbaDefinition = {
  name: 'NBA: Elo z przewagą parkietu i malejącą wagą różnicy punktów',
  outcomes: ['home', 'away'],
  create() {
    const ratings = new Map();
    const rating = id => ratings.get(id) ?? 1500;
    const probability = event => eloProbability(rating(event.homeId) - rating(event.awayId) + (event.neutralSite ? 0 : 60));
    return {
      predict(event) { const p = probability(event); return [p, 1 - p]; },
      update(event) {
        const p = probability(event);
        const margin = clamp(Math.log1p(Math.abs(event.homeScore - event.awayScore)) / Math.log(11), 0.5, 1.5);
        const adjustment = 24 * margin * ((event.homeScore > event.awayScore ? 1 : 0) - p);
        ratings.set(event.homeId, rating(event.homeId) + adjustment);
        ratings.set(event.awayId, rating(event.awayId) - adjustment);
      }
    };
  }
};
