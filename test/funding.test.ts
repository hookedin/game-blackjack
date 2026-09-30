import test from 'node:test';
import assert from 'node:assert/strict';
import {
  add,
  fraction,
  multiply,
  OUTCOME_SPACE,
  compileGame,
  getNode,
  optimalExpectedValuePolicy,
  prepareAction,
  resolveTransition,
} from '@hookedin/play/sdk/engine';
import type { TransitionPlan } from '@hookedin/play/sdk/engine';

import { admits, assessBet, betReturn, RETURN_SCALE } from '@hookedin/play/sdk/admits';
import { createBlackjack } from '../src/rules.ts';
import { blackjackFunding } from '../src/funding.ts';

const UNIT = 10n ** 18n;
const ZERO = fraction(0n);
const ONE = fraction(1n);
const graph = createBlackjack({ stake: UNIT });
// The suite's one full compile: the generator's rules at the table's scale.
const scale = UNIT / blackjackFunding.initialCash;
const plan = compileGame(graph, {
  admits,
  bankrollFloor: blackjackFunding.bankrollFloor * scale,
  cashQuantum: blackjackFunding.cashQuantum * scale,
  initialCash: UNIT,
});

test('the funding table scales exactly to the stakes it serves', () => {
  const decisions = plan.nodes.filter(node => node.kind === 'decision');
  assert.deepEqual(Object.keys(blackjackFunding.actions), decisions.map(node => node.id).sort());
  for (const node of decisions)
    assert.deepEqual(
      node.actions.map(action => action.requiredCash),
      blackjackFunding.actions[node.id].map(cash => cash * scale),
      node.id,
    );
  assert.equal(plan.initialCash, blackjackFunding.initialCash * scale);
  assert.equal(plan.conservativeBankroll, blackjackFunding.conservativeBankroll * scale);
  assert.equal(plan.nodes.length, 14065);
  assert.equal(plan.maximumDepth, 52);
  assert.equal(plan.maximumCash, 8n * UNIT);
  assert.equal(plan.requiredCash, 999452000000000000n);
});

/**
 * A hand is played as one bet per step, and a step stakes the cash the hand holds above the class of outcomes it can
 * fall to, so what a single bet pays back is not what the hand pays back: a double can be a bet that seldom pays, and
 * standing charges the retained cash with no prize at all. The measured return of one step is that step's, never the
 * hand's.
 */
test('every blackjack action collapses into admitted bets that reach each successor state at its stated odds', () => {
  let steps = 0,
    most = 0,
    payments = 0,
    worst = RETURN_SCALE;
  for (const source of graph.nodes) {
    if (source.kind !== 'decision') continue;
    const priced = getNode(plan, source.id);
    assert.equal(priced.kind, 'decision');
    for (const action of source.actions) {
      const pricedAction: any = (priced as any).actions.find((value: any) => value.id === action.id);
      const step: TransitionPlan = pricedAction.transition;
      assert.deepEqual(
        [...step.outcomes].map(o => [o.next, o.label, o.probability]).sort(),
        action.outcomes
          .filter(o => o.probability.n > 0n)
          .map(o => [o.next, o.label, o.probability])
          .sort(),
        'every original successor and card label survives',
      );
      if (step.kind !== 'casino-bet') {
        if (step.amount > 0n) payments++;
        continue;
      }
      // Every class is reached exactly as often as its cards say, and every bet the page can draw is one the
      // casino's own rule admits at the planning floor, and costs the bankroll less than the most any state holds.
      const reached = step.classes.map(() => ZERO);
      for (const branch of step.branches) {
        if (branch.kind === 'none') {
          reached[branch.class] = add(reached[branch.class]!, branch.weight);
          continue;
        }
        const q = fraction(branch.bet.chance, OUTCOME_SPACE);
        reached[branch.win] = add(reached[branch.win]!, multiply(branch.weight, q));
        reached[branch.lose] = add(reached[branch.lose]!, multiply(branch.weight, add(ONE, fraction(-q.n, q.d))));
        assert.equal(branch.bet.stake, priced.cash + pricedAction.additionalCash - step.classes[branch.lose]!.cash);
        const risk = assessBet({ bankroll: plan.bankrollFloor, bet: branch.bet });
        assert.ok(risk.liability - risk.fee < plan.maximumCash);
        if (betReturn(branch.bet) < worst) worst = betReturn(branch.bet);
      }
      for (const [i, c] of step.classes.entries()) {
        assert.deepEqual(reached[i], c.probability);
        for (const o of c.outcomes) assert.equal(o.cash, getNode(plan, o.next).cash);
      }
      most = Math.max(most, step.branches.length);
      steps++;
    }
  }
  assert.ok(steps > 1000);
  assert.ok(most <= 100, `at most ${most} branches in one step`);
  assert.ok(payments > 0, 'standing charges the hand with no prize: a debit that pays nothing back');
  assert.ok(worst < RETURN_SCALE / 2n, `the worst single bet pays back ${worst} millionths, nothing like the hand`);
});

test('the extreme outcomes of every round complete funded blackjack paths', () => {
  const policies = [
    optimalExpectedValuePolicy(plan),
    (node: any) => node.actions.find((a: any) => a.id === 'hit')?.id ?? node.actions[0].id,
  ];
  for (const policy of policies)
    for (const outcome of [0n, OUTCOME_SPACE / 3n, OUTCOME_SPACE - 1n]) {
      let state = { nodeId: plan.root, cash: plan.initialCash, bankroll: plan.conservativeBankroll };
      let contributions = 0n;
      let steps = 0;
      const total = state.cash + state.bankroll;
      while (getNode(plan, state.nodeId).kind !== 'terminal') {
        const node = getNode(plan, state.nodeId);
        const step = prepareAction(plan, state, policy(node as any), () => 0n);
        const result = resolveTransition(step, step.kind === 'casino-bet' ? outcome : undefined);
        contributions += step.additionalCash;
        state = result.state;
        assert.equal(state.cash, getNode(plan, state.nodeId).cash);
        assert.equal(state.cash + state.bankroll, total + contributions);
        assert(state.bankroll >= plan.bankrollFloor);
        assert(++steps <= plan.maximumDepth);
      }
      assert(plan.nodes.some(n => n.kind === 'terminal' && n.cash === state.cash));
    }
});
