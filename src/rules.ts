import { add, fraction } from '@hookedin/play/sdk/engine';
import type { GameAction, GameGraph, GameNode, GameOutcome, Rational } from '@hookedin/play/sdk/engine';

/** 1 denotes an ace; 10 aggregates ten, jack, queen, and king. */
export type CardRank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

interface BlackjackHand {
  /** Best total, with at most one ace counted as eleven. */
  readonly total: number;
  readonly soft: boolean;
}

interface BlackjackResult {
  /** 16 groups all standing totals below 17; 22 is bust; 23 is a natural. */
  readonly total: number;
  readonly multiplier: 1 | 2;
}
interface BlackjackState extends BlackjackHand {
  readonly phase: 'first' | 'second' | 'upcard' | 'insurance' | 'peek' | 'player' | 'split-deal' | 'hole' | 'dealer';
  readonly dealerUpcard: CardRank | 0;
  readonly pair: CardRank | 0;
  readonly firstTwo: boolean;
  readonly split: boolean;
  readonly pendingSplit: CardRank | 0;
  readonly completed: readonly BlackjackResult[];
  readonly multiplier: 1 | 2;
}

const EMPTY: BlackjackHand = Object.freeze({ total: 0, soft: false });
const ONE = fraction(1n);

function assertRank(rank: number): asserts rank is CardRank {
  if (!Number.isInteger(rank) || rank < 1 || rank > 10) {
    throw new RangeError('a card rank must be an integer from 1 (ace) through 10');
  }
}

function cardProbability(rank: CardRank): Rational {
  assertRank(rank);
  return fraction(rank === 10 ? 4n : 1n, 13n);
}

/** The same replacement-deck probabilities apply after every exposed card. */
export function addCard(hand: BlackjackHand, rank: CardRank): BlackjackHand {
  assertRank(rank);
  if (!Number.isInteger(hand.total) || hand.total < 0 || hand.total > 21 || (hand.soft && hand.total < 11)) {
    throw new RangeError('addCard requires an unbusted hand with a valid best total');
  }
  let total = hand.total;
  let soft = hand.soft;
  if (rank === 1) {
    // If an existing ace already counts as eleven, count this one as one.
    total += soft ? 1 : 11;
    soft = true;
  } else {
    total += rank;
  }
  if (total > 21 && soft) {
    total -= 10;
    soft = false;
  }
  return Object.freeze({ total, soft });
}

const INITIAL: BlackjackState = Object.freeze({
  phase: 'first',
  total: 0,
  soft: false,
  dealerUpcard: 0,
  pair: 0,
  firstTwo: false,
  split: false,
  pendingSplit: 0,
  completed: Object.freeze([]),
  multiplier: 1,
});
const FACES = Object.freeze(Array.from({ length: 13 }, (_, i) => i + 1));
const rankOf = (face: number): CardRank => Math.min(face, 10) as CardRank;

function stateId(s: BlackjackState): string {
  return `blackjack:${[
    s.phase,
    s.total,
    +s.soft,
    s.dealerUpcard,
    s.pair,
    +s.firstTwo,
    +s.split,
    s.pendingSplit,
    s.completed.map(h => `${h.total}x${h.multiplier}`).join(',') || '-',
    s.multiplier,
  ].join(':')}`;
}

/** Public information only: the hole card is sampled conditionally after play. */
export function blackjackState(id: string): BlackjackState | undefined {
  const match =
    /^blackjack:(first|second|upcard|insurance|peek|player|split-deal|hole|dealer):(\d+):([01]):(\d+):(\d+):([01]):([01]):(\d+):(-|\d+x[12](?:,\d+x[12])?):([12])$/.exec(
      id,
    );
  if (!match) return undefined;
  return Object.freeze({
    phase: match[1] as BlackjackState['phase'],
    total: Number(match[2]),
    soft: match[3] === '1',
    dealerUpcard: Number(match[4]) as CardRank | 0,
    pair: Number(match[5]) as CardRank | 0,
    firstTwo: match[6] === '1',
    split: match[7] === '1',
    pendingSplit: Number(match[8]) as CardRank | 0,
    completed: Object.freeze(
      match[9] === '-'
        ? []
        : match[9]!.split(',').map(value => {
            const [total, multiplier] = value.split('x').map(Number);
            return Object.freeze({ total: total!, multiplier: multiplier as 1 | 2 });
          }),
    ),
    multiplier: Number(match[10]) as 1 | 2,
  });
}

/**
 * Stake Originals rules: infinite deck, S17, peek, 3:2 naturals, double any first two (including split),
 * split once, one card to split aces, no surrender, half-stake 2:1 insurance.
 * Additional bets are player contributions, never free increases in the prize.
 * Both split hands settle against ONE dealer. Face labels retain individual
 * draws while equivalent economic states share continuation pricing.
 */
export function createBlackjack({ stake }: { readonly stake: bigint }): GameGraph {
  if (typeof stake !== 'bigint' || stake <= 0n || stake % 2n !== 0n) {
    throw new RangeError('blackjack stake must be a positive, even bigint for exact 3:2 payouts');
  }
  const nodes = new Map<string, GameNode>();
  function payout(halfUnits: number): string {
    const id = `blackjack:payout:${halfUnits}`;
    if (!nodes.has(id))
      nodes.set(id, Object.freeze({ id, kind: 'terminal', payout: (stake * BigInt(halfUnits)) / 2n }));
    return id;
  }
  const certain = (next: string): readonly GameOutcome[] => [{ next, probability: ONE }];
  const natural = (s: BlackjackState) => !s.split && s.firstTwo && s.total === 21;
  function cards(target: string, next: (rank: CardRank) => string, excluded: CardRank | 0 = 0): readonly GameOutcome[] {
    const allowed = FACES.filter(face => rankOf(face) !== excluded);
    return allowed.flatMap(face => {
      const destination = next(rankOf(face));
      return [0, 1, 2, 3].map(suit =>
        Object.freeze({
          next: destination,
          probability: fraction(1n, BigInt(allowed.length * 4)),
          label: `${target}:${face}:${suit}`,
        }),
      );
    });
  }
  function settle(completed: readonly BlackjackResult[], dealer: BlackjackHand): string {
    let halfUnits = 0;
    for (const hand of completed) {
      if (hand.total === 23) halfUnits += 5;
      else if (hand.total !== 22)
        halfUnits +=
          hand.multiplier * (dealer.total > 21 || hand.total > dealer.total ? 4 : hand.total === dealer.total ? 2 : 0);
    }
    return payout(halfUnits);
  }
  function dealer(s: BlackjackState): string {
    if (s.total >= 17 || s.completed.some(h => h.total === 23)) return settle(s.completed, s);
    return visit({ ...s, phase: 'dealer', dealerUpcard: 0 });
  }
  function finish(s: BlackjackState): string {
    const result: BlackjackResult = {
      total: natural(s) ? 23 : s.total > 21 ? 22 : Math.max(16, s.total),
      multiplier: s.multiplier,
    };
    const completed = [...s.completed, result];
    if (s.pendingSplit) {
      return visit({
        ...INITIAL,
        phase: 'split-deal',
        ...addCard(EMPTY, s.pendingSplit),
        dealerUpcard: s.dealerUpcard,
        split: true,
        pair: s.pendingSplit,
        completed,
      });
    }
    if (completed.every(h => h.total === 22)) return payout(0);
    // Once both hands are finished their order cannot affect dealer settlement.
    completed.sort((a, b) => a.total - b.total || a.multiplier - b.multiplier);
    return visit({
      ...INITIAL,
      phase: 'hole',
      ...addCard(EMPTY, s.dealerUpcard as CardRank),
      dealerUpcard: s.dealerUpcard,
      completed,
    });
  }
  function player(s: BlackjackState): string {
    return s.total >= 21 ? finish(s) : visit({ ...s, phase: 'player' });
  }
  function check(s: BlackjackState, insured: boolean): readonly GameOutcome[] {
    const complement: CardRank = s.dealerUpcard === 1 ? 10 : 1;
    const probability = cardProbability(complement);
    const outcomes: GameOutcome[] = [
      { next: player(s), probability: add(ONE, fraction(-probability.n, probability.d)), label: 'no-blackjack' },
    ];
    for (const face of FACES.filter(face => rankOf(face) === complement)) {
      for (const suit of [0, 1, 2, 3])
        outcomes.push({
          next: payout((natural(s) ? 2 : 0) + (insured ? 3 : 0)),
          probability: fraction(1n, 52n),
          label: `dealer-blackjack:${face}:${suit}`,
        });
    }
    return outcomes;
  }
  function visit(s: BlackjackState): string {
    const id = stateId(s);
    if (nodes.has(id)) return id;
    nodes.set(id, { id, kind: 'decision', actions: [] });
    const actions: GameAction[] = [];
    const action = (id: string, outcomes: readonly GameOutcome[], additionalCash = 0n) =>
      actions.push(Object.freeze({ id, outcomes: Object.freeze(outcomes), additionalCash }));
    const handIndex = s.completed.length;
    switch (s.phase) {
      case 'first':
        action(
          'deal',
          cards('player:0', rank => visit({ ...s, phase: 'second', ...addCard(EMPTY, rank), pair: rank })),
        );
        break;
      case 'second':
        action(
          'deal',
          cards('player:0', rank =>
            visit({ ...s, phase: 'upcard', ...addCard(s, rank), pair: rank === s.pair ? rank : 0, firstTwo: true }),
          ),
        );
        break;
      case 'upcard':
        action(
          'deal',
          cards('dealer', rank => {
            const next = { ...s, dealerUpcard: rank };
            return rank === 1
              ? visit({ ...next, phase: 'insurance' })
              : rank === 10
                ? visit({ ...next, phase: 'peek' })
                : player(next);
          }),
        );
        break;
      case 'insurance':
        action('decline-insurance', check(s, false));
        action('insurance', check(s, true), stake / 2n);
        break;
      case 'peek':
        action('peek', check(s, false));
        break;
      case 'player':
        action('stand', certain(finish(s)));
        action(
          'hit',
          cards(`player:${handIndex}`, rank => player({ ...s, ...addCard(s, rank), pair: 0, firstTwo: false })),
        );
        if (s.firstTwo)
          action(
            'double',
            cards(`player:${handIndex}`, rank =>
              finish({ ...s, ...addCard(s, rank), pair: 0, firstTwo: false, multiplier: 2 }),
            ),
            stake,
          );
        if (s.pair && !s.split)
          action(
            'split',
            certain(
              visit({
                ...INITIAL,
                phase: 'split-deal',
                ...addCard(EMPTY, s.pair),
                dealerUpcard: s.dealerUpcard,
                split: true,
                pair: s.pair,
                pendingSplit: s.pair,
              }),
            ),
            stake,
          );
        break;
      case 'split-deal':
        action(
          'deal-split',
          cards(`player:${handIndex}`, rank => {
            const next: BlackjackState = { ...s, ...addCard(s, rank), pair: 0, firstTwo: true };
            return s.pair === 1 ? finish(next) : player(next);
          }),
        );
        break;
      case 'hole': {
        const excluded = s.dealerUpcard === 1 ? 10 : s.dealerUpcard === 10 ? 1 : 0;
        action(
          'reveal',
          cards('dealer', rank => dealer({ ...s, ...addCard(s, rank) }), excluded),
        );
        break;
      }
      case 'dealer':
        action(
          'dealer-hit',
          cards('dealer', rank => dealer({ ...s, ...addCard(s, rank) })),
        );
        break;
    }
    nodes.set(id, Object.freeze({ id, kind: 'decision', actions: Object.freeze(actions) }));
    return id;
  }
  const root = visit(INITIAL);
  return Object.freeze({ root, nodes: Object.freeze([...nodes.values()]) });
}
