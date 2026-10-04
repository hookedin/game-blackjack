import { HookedIn } from '@hookedin/play/sdk/sdk';
import { RoundClient } from '@hookedin/play/sdk/round';
import type { RoundState } from '@hookedin/play/sdk/round';
import { blackjackState, createBlackjack } from './rules.ts';
import { blackjackFunding } from './funding.ts';
import { blackjackTable, cardHand, handResults } from './view.ts';
import type { Card } from './view.ts';
const round = new RoundClient(HookedIn, setup => createBlackjack({ stake: BigInt(setup.stake) }), blackjackFunding);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const stake = $<HTMLInputElement>('stake');
/** The steps the table takes by itself: dealing, the dealer's peek and the dealer's play. */
const automatic = new Set(['deal', 'peek', 'deal-split', 'reveal', 'dealer-hit']);
/** The player's moves, by their keys. */
const keys: Record<string, string> = {
  h: 'hit',
  s: 'stand',
  d: 'double',
  p: 'split',
  i: 'insurance',
  n: 'decline-insurance',
};
const RANKS: Record<number, string> = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' },
  NAMES: Record<number, string> = { 1: 'Ace', 11: 'Jack', 12: 'Queen', 13: 'King' },
  SUITS = ['♦', '♥', '♠', '♣'],
  SUIT_NAMES = ['diamonds', 'hearts', 'spades', 'clubs'],
  RESULTS = { blackjack: 'Blackjack', win: 'Win', push: 'Push', lose: 'Lose', bust: 'Bust' };
let session: RoundState | null = null,
  busy = false,
  ready = false,
  // When the next card starts in, so that cards arriving together are still dealt one by one, never long after.
  dealing = 0;
const amount = (value: bigint) => `${HookedIn.formatAmount(value)} METH`;
const message = (value: string, error = false) => {
  $('status').textContent = value;
  $('status').dataset.error = String(error);
  // On a short phone the line sits below the deal: a problem is brought into view.
  if (error) $('status').scrollIntoView({ block: 'nearest' });
};
/** Show `hand` in `row`, keeping the cards already there so that only new ones are dealt in. `hole` adds the dealer's
 * face-down card, which flips when it is turned up. */
function showCards(row: HTMLElement, hand: readonly Card[], hole: boolean) {
  const wanted = hand.map(card => `${card.face}:${card.suit}`);
  if (hole) wanted.push('hole');
  const shown = [...row.children] as HTMLElement[];
  let kept = 0;
  while (kept < shown.length && shown[kept]!.dataset.card === wanted[kept]) kept++;
  const turned = shown[kept]?.dataset.card === 'hole';
  for (const card of shown.slice(kept)) card.remove();
  for (const key of wanted.slice(kept)) {
    const card = document.createElement('div'),
      [face, suit] = key.split(':').map(Number) as [number, number];
    card.dataset.card = key;
    card.className = key === 'hole' ? 'card back deal' : `card ${suit < 2 ? 'red ' : ''}${turned ? 'flip' : 'deal'}`;
    if (key !== 'hole') {
      card.dataset.suit = SUITS[suit];
      card.setAttribute('role', 'img');
      card.setAttribute('aria-label', `${NAMES[face] ?? face} of ${SUIT_NAMES[suit]}`);
      card.append(RANKS[face] ?? String(face));
    }
    const now = performance.now(),
      start = Math.min(Math.max(dealing, now), now + 450);
    card.style.animationDelay = `${start - now}ms`;
    dealing = start + 150;
    row.append(card);
  }
}
/** A finished round: its headline, whether it came out ahead, and by how much. */
function verdict(state: RoundState, table: ReturnType<typeof blackjackTable>) {
  const net = BigInt(state.cash) - BigInt(state.contributed),
    results = handResults(table);
  return {
    tone: net > 0n ? 'win' : net < 0n ? 'lose' : 'push',
    title: table.dealerBlackjack
      ? 'Dealer blackjack'
      : results.includes('blackjack')
        ? 'Blackjack!'
        : results.every(result => result === 'bust')
          ? 'Bust'
          : net > 0n
            ? 'You win'
            : net < 0n
              ? 'Dealer wins'
              : results.every(result => result === 'push')
                ? 'Push'
                : 'Break even',
    amount: net > 0n ? `+${amount(net)}` : net < 0n ? `−${amount(-net)}` : 'Bet returned',
  };
}
function render() {
  const active = Boolean(session && !session.terminal),
    actions = session?.actions ?? [],
    paused = active && actions.some(action => automatic.has(action)),
    state = active ? blackjackState(session!.nodeId) : undefined,
    table = blackjackTable(session?.events ?? []),
    results = session?.terminal ? handResults(table) : [];
  for (const id of ['stake', 'half', 'twice']) $<HTMLInputElement>(id).disabled = busy || active;
  for (const id of Object.values(keys)) $<HTMLButtonElement>(id).disabled = busy || !ready || !actions.includes(id);
  $<HTMLButtonElement>('deal').disabled = busy || !ready || (active && !paused);
  $('deal-label').textContent = busy ? 'Dealing' : !ready ? 'Connecting' : paused ? 'Continue' : 'Deal';
  $('deal-label').classList.toggle('busy-label', busy);
  showCards($('dealer-cards'), table.dealer, table.dealer.length === 1);
  const dealer = cardHand(table.dealer);
  $('dealer-total').textContent = table.dealer.length ? String(dealer.total) : '';
  $('dealer-tag').textContent = table.dealerBlackjack ? 'Blackjack' : dealer.total > 21 ? 'Bust' : '';
  $('insured').textContent = table.insured ? `Insurance ${table.dealerBlackjack ? 'won' : 'lost'}` : '';
  for (const index of [0, 1]) {
    const seat = $(`hand-${index}`),
      cards = table.hands[index] ?? [],
      hand = cardHand(cards),
      // The hand in play shows both counts of a soft total.
      playing = active && state?.completed.length === index,
      result = results[index] ?? (hand.total > 21 ? 'bust' : '');
    seat.classList.toggle('hidden', index > 0 && !table.split);
    seat.classList.toggle('active', table.split && playing && state?.phase === 'player');
    seat.dataset.result = result;
    showCards(seat.querySelector('.cards')!, cards, false);
    seat.querySelector('.total')!.textContent = !cards.length
      ? ''
      : playing && hand.soft && hand.total < 21
        ? `${hand.total - 10}/${hand.total}`
        : String(hand.total);
    seat.querySelector('.tag')!.textContent =
      `${result ? RESULTS[result] : ''} ${table.doubled[index] ? '×2' : ''}`.trim();
  }
  $('offer').classList.toggle('hidden', !actions.includes('insurance'));
  $('offer-cost').textContent = amount(BigInt(session?.actionCosts.insurance ?? 0));
  // The result comes in once the last card has.
  if (session?.terminal && $('result').classList.contains('hidden'))
    $('result').style.animationDelay = `${Math.max(dealing - performance.now(), 0) + 150}ms`;
  $('result').classList.toggle('hidden', !session?.terminal);
  if (session?.terminal) {
    const { tone, title, amount } = verdict(session, table);
    $('result').dataset.tone = tone;
    $('result-title').textContent = title;
    $('result-amount').textContent = amount;
  }
}
function status() {
  if (!session) return message('Set your bet and deal.');
  const table = blackjackTable(session.events);
  if (session.terminal) {
    const { title, amount } = verdict(session, table);
    message(`${title} · ${amount}`);
  } else if (session.actions.includes('insurance')) message('The dealer shows an ace. Take insurance?');
  else if (session.actions.some(action => automatic.has(action))) message('Continue to finish the hand.');
  else {
    const index = blackjackState(session.nodeId)!.completed.length;
    message(
      `Your move${table.split ? ` on hand ${index + 1}` : ''}: ${cardHand(table.hands[index]!).total} against the dealer's ${cardHand(table.dealer).total}.`,
    );
  }
}
async function finishAutomatic() {
  while (session && !session.terminal && session.actions.length === 1 && automatic.has(session.actions[0]!)) {
    session = await round.action(session.actions[0]!);
    render();
  }
}
async function play(action?: string) {
  if (busy || !ready) return;
  busy = true;
  message('');
  render();
  try {
    if (!session || session.terminal) {
      const wei = HookedIn.parseAmount(stake.value);
      if (HookedIn.wholeStake(wei, 2n) !== BigInt(wei)) throw new Error('Your bet must be an even number of METH.');
      session = await round.start({ stake: wei });
      render();
    } else if (action) session = await round.action(action);
    await finishAutomatic();
    status();
    // The hand's winnings join the allowance the wallet shows once its last card is on the table.
    if (session.terminal) {
      const hand = session.id;
      setTimeout(() => void HookedIn.end(hand).catch(() => {}), Math.max(dealing - performance.now(), 0) + 150);
    }
  } catch (error: any) {
    try {
      session = await round.restore();
    } catch {}
    message(error.message, true);
  } finally {
    busy = false;
    render();
  }
}
/** Halve or double the bet, keeping it a positive, even number of METH. */
function scale(up: boolean) {
  try {
    const wei = BigInt(HookedIn.parseAmount(stake.value));
    stake.value = HookedIn.exactAmount(up ? wei * 2n : HookedIn.wholeStake(wei / 2n, 2n));
  } catch {}
}
$('deal').addEventListener('click', () => play());
for (const id of Object.values(keys)) $(id).addEventListener('click', () => play(id));
$('half').addEventListener('click', () => scale(false));
$('twice').addEventListener('click', () => scale(true));
stake.addEventListener('keydown', event => event.key === 'Enter' && $('deal').click());
document.addEventListener('keydown', event => {
  const target = event.target as HTMLElement,
    move = keys[event.key.toLowerCase()];
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || target instanceof HTMLInputElement) return;
  if (move) $(move).click();
  // A focused control answers Space itself.
  else if (event.code === 'Space' && !target.closest('button, summary')) {
    event.preventDefault();
    $('deal').click();
  }
});
async function recover() {
  try {
    await HookedIn.initializeGame({ stakeInput: stake });
    // A bet is an even number of METH, so its half-stake insurance is whole METH too.
    try {
      stake.value = HookedIn.exactAmount(HookedIn.wholeStake(HookedIn.parseAmount(stake.value), 2n));
    } catch {}
    // Ready before the hand is restored: a hand this page cannot finish is let go with a word, and the
    // player plays on.
    ready = true;
    session = await round.restore();
    // Deal repeats the last hand's bet.
    if (session) stake.value = HookedIn.exactAmount(session.setup.stake);
    status();
    round.watch(() => {
      if (busy) return;
      session = round.state();
      render();
    });
  } catch (error: any) {
    message(error.message, true);
  } finally {
    render();
  }
}
render();
void recover();
