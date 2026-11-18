import { createGoalState, goalProbabilities } from './utils.js';

export const nhlDefinition = {
  name: 'NHL: Poisson bramek końcowych, masa remisu rozdzielona 50/50',
  outcomes: ['home', 'away'],
  create() {
    const state = createGoalState({ homePrior: 3.1, awayPrior: 2.9, priorGames: 20, maximumRate: 7 });
    return {
      predict(event) {
        const [home, tie, away] = goalProbabilities(...state.rates(event));
        // No reliable historical overtime-specific features are available.
        // Tie mass is split symmetrically; final result includes OT/shootout.
        return [home + tie / 2, away + tie / 2];
      },
      update: event => state.update(event)
    };
  }
};
