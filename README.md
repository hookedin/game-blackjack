# HookedIn Blackjack

Blackjack with hit, stand, double, split and insurance, dealt from an unlimited deck: a house game of
[HookedIn](https://play.hookedin.com), and the example of a multi-step game, where every step is at most one casino bet
the player's wallet signs and verifies. It is served at `https://blackjack-game.hookedin.com/`, and deploys itself from
this repository.

## How to play

Give the game money from your balance with **Add funds**. Set your bet, halve or double it with **½** and
**2×**, and deal; the bet stays for the next hand, so dealing again repeats it. On a keyboard, Space deals, H hits, S
stands, D doubles, P splits, and I or N take or refuse insurance. The table rules follow Stake Originals Blackjack:

| Rule            | Behaviour                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| Cards           | Every card is an independent 1-in-52 draw, with replacement (unlimited decks)                             |
| Dealer          | Stands on all 17s, and checks for blackjack before you play                                               |
| Blackjack       | Pays 3:2. Two naturals push                                                                               |
| Wins and pushes | An ordinary win pays 1:1. A push returns the bet                                                          |
| Double          | On any first two cards, including after a split. One more card                                            |
| Split           | One equal-value pair, once, for an additional equal bet. No re-splitting. Both hands face the same dealer |
| Split aces      | One card each. A split 21 is not a natural                                                                |
| Insurance       | Offered against an Ace. Costs half the bet, pays 2:1                                                      |
| Surrender       | None                                                                                                      |

The stake must be an even number of wei. Doubles, splits and insurance need enough additional money in the game
balance; the game asks the wallet for more when they do not fit.

## How it works

The rules are a graph: `createBlackjack({ stake })` in [src/rules.ts](src/rules.ts) builds a finite graph of public
states, each decision listing its legal actions and each action its successor states with exact probabilities, one per
card. The game SDK's `RoundClient` plays the hand on it. The SDK's engine works backward through the graph and gives
every state a cash value, the least money that finances each action from it as bets the casino admits, and each step
becomes nothing, a payment to the bankroll, or one casino bet between a lower and a higher class of successors, drawn
by the page with its own randomness so that every class is reached exactly as often as the rules say. See
[sequential games built from casino bets](https://hookedin.com/docs/games/sequential-games/).

Pricing the whole graph takes time, so the page hands `RoundClient` a precomputed table, [src/funding.ts](src/funding.ts):
each action's required cash at a 1,000,000-wei stake and a planning bankroll of 256 stakes. It applies when the stake is
a multiple of 1,000,000 wei and the bankroll covers 672 stakes; any other stake is priced in the page. `npm run generate`
writes the table from the rules, and `npm test` fails if it does not match them.

With optimal play through a completed hand the house edge is exactly
`40248916821673328324125295 / 7056410014866816666030739693`, 0.5703880122736% of the initial bet.
[test/rules.test.ts](test/rules.test.ts) proves it against an independent oracle that works from raw totals, without
the graph or the pricing engine, checks each table rule above, and checks that the result the page shows for each hand
is what the rules pay. [test/funding.test.ts](test/funding.test.ts) checks that every action collapses into bets the
casino admits and that reach each successor at its stated odds, and [test/round.test.ts](test/round.test.ts) plays a
hand through the real wallet, reloading it midway.

The page is untrusted by design: it runs in a sandboxed frame and only asks the wallet for bets. The wallet verifies
each bet it signs; that the cards come as often as an unlimited deck deals them is this page's claim, open source here.
The cards on screen are replayed from the labels of settled steps, so a reload mid-hand shows the same cards.

## Run it

You need Node 24.4 or later.

```sh
npm install
npm run dev
```

This serves the game at `http://127.0.0.1:4185/`, building it again on every page load. Open the wallet at
[play.hookedin.com](https://play.hookedin.com), choose **Open a game by its URL** under the games and paste that address.

`npm test` type-checks, checks the funding table and runs the tests. `npm run build` writes `dist/`, plain static files
with the page, `game.js` and `icon.svg`.

## Deploy

Every push runs [the deploy workflow](.github/workflows/deploy.yml); a push to `main` also publishes `dist/` to
Cloudflare as the Worker in [wrangler.jsonc](wrangler.jsonc). It needs the `CLOUDFLARE_API_TOKEN` secret and the
`CLOUDFLARE_ACCOUNT_ID` variable. `@hookedin/play` comes from play's `main`, at the commit the lockfile records;
`npm update @hookedin/play` moves it.

## License

[MIT](LICENSE)
