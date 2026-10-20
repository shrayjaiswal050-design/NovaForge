# Nova Chess

Nova Chess is a private chess lobby with a custom local engine, same-browser
two-player games, direct friend games, and exact-bucket random matchmaking. The
code remains in this workspace's `chess-game/` directory. Start a shell in that
directory before running the relative commands below; they do not depend on a
particular machine path.

## Supported modes

- **Human vs. NovaForge (local AI):** play against the JavaScript engine in a
  Web Worker. Difficulty presets control the engine's search time and depth.
- **Local two-player:** two people can play from the same browser and device;
  no online room or second server connection is needed.
- **Play a friend:** add an accepted friend by handle, send a direct invite, and
  play Standard Chess or Chess960 with a real server clock.
- **Random opponent:** enter a queue keyed by the exact variant and time
  control. The server pairs two authenticated players, assigns colors, and
  keeps opponent ratings private until the game ends.

### NovaForge strength disclaimer

NovaForge is a custom JavaScript chess engine. It does **not** use Stockfish,
Stockfish source code, Stockfish weights, or an opening book. It is a practical
first-build searcher, not a measured Stockfish replacement, and no Stockfish-level
strength or official Elo rating is claimed. Its fixed difficulty labels are local
search presets, not calibrated playing-strength ratings. Adaptive Elo is a local
practice score that lowers or raises NovaForge's search level after each AI game
to keep the challenge encouraging; it is not a competitive rating. Each new AI
game also gets a private variation seed, so NovaForge can choose a different
near-equal style without randomizing forced tactics or legal-move selection. The
Apex preset keeps only exact-score variety and does not intentionally select a
lower-scoring root move.

## Accounts and privacy

Signup asks only for a handle, display name, password, and fair-play acceptance.
There is no email collection, browser API key, advertising, or tracking. Passwords
are stored as salted scrypt hashes. Account, friend, session, and rating records
are stored in SQLite so a login works after a restart or from another device.
The prototype has no password recovery flow. A user who forgets the password
cannot recover the account through this app.

The server uses an HttpOnly session cookie. Keep the database file private and
serve the application over HTTPS/WSS outside a trusted local machine.

## Prerequisites

For a clean Linux checkout, install or make available:

- `nvm` (Node Version Manager)
- Node.js **22.23.3** exactly
- `npm` compatible with that Node.js installation

The lockfile pins the dependency tree and records the required Node version.

## Clean setup

From the project's `chess-game/` directory:

```bash
nvm install 22.23.3
nvm use 22.23.3
node --version       # v22.23.3
npm --version
npm ci
```

### Optional environment file

The repository includes a non-secret `.env.example` with local runtime defaults.
Initialize a private local copy and review it before use:

```bash
cp .env.example .env
chmod 600 .env
```

Keep `.env` out of version control and do not put credentials in the README,
shell history, logs, or issue reports. The `npm start` script loads `.env`
automatically with Node 22's built-in env-file support. You can still override a
setting for a single run, for example:

```bash
PORT=8787 npm start
```

The server reads `PORT`, `HOST`, `ROOM_TTL_MS`, `CLOCK_INTERVAL_MS`,
`MAX_PAYLOAD_BYTES`, and `AUTH_DB_PATH` from the environment and falls back to
the documented defaults when a value is absent or invalid. The default database
is `./data/nova-chess.sqlite`, which is ignored by Git.

## Run locally

Start the HTTP and WebSocket server:

```bash
npm start
```

Open the game in a browser at <http://127.0.0.1:8787/>. The server uses
`PORT` when it is set and otherwise defaults to `8787`. The health endpoint is:

```bash
curl --fail http://127.0.0.1:8787/health
```

It returns a small JSON response such as `{"ok":true,"service":"nova-chess"}`.

The server is the recommended local entry point for every mode. Friend games and
random matchmaking need the HTTP server, authenticated session cookie, and its
same-origin WebSocket endpoint. Opening the HTML file directly is not an online
setup.

## Time controls

The notation is **initial minutes per side + increment seconds after each
accepted move**:

| Control | Initial time | Increment |
| --- | ---: | ---: |
| `1+0` | 1 minute | 0 seconds |
| `2+1` | 2 minutes | 1 second |
| `3+2` | 3 minutes | 2 seconds |
| `5+3` | 5 minutes | 3 seconds |
| `10+0` | 10 minutes | 0 seconds |
| `15+10` | 15 minutes | 10 seconds |

The default is `5+3`. Local clocks run in the browser. Online clocks are
settled by the server, and an increment is applied exactly once after a move is
accepted.

## Friend games, random matchmaking, and WebSockets

WebSockets must be same-origin with the page that opened them. Use the browser
URL served by this application, and have both players use the same scheme, host,
and port. The browser client automatically uses `ws://` for an HTTP page and
`wss://` for an HTTPS page; the server rejects a browser upgrade whose origin
does not match the request host and protocol.

Friend games and random games are authoritative on the server. The game state is
kept in memory while active, while accounts, friendships, sessions, and ratings
are persisted in SQLite. Active games and reconnect capabilities are lost if the
server process is replaced before the game finishes.

Random matchmaking uses exact buckets: Standard or Chess960 plus one of the
supported time controls. It does not expose a public room code or let a client
choose an opponent.

Ratings are separate pools:

| Variant | Bullet | Blitz | Rapid |
| --- | ---: | ---: | ---: |
| Standard | 1200 start | 1200 start | 1200 start |
| Chess960 | 1200 start | 1200 start | 1200 start |

`1+0` and `2+1` are Bullet with K=40; `3+2` and `5+3` are Blitz with K=32;
`10+0` and `15+10` are Rapid with K=24. Ratings stay hidden during an active
online game and are shown with the result after it ends.

Before every AI game, the lobby requires an explicit NovaForge level: Adaptive
Elo or a fixed search preset; there is no implicit default. After resignation,
timeout, checkmate, or a draw, the app opens a
final-position analysis view. Local, friend, and random games do not show the live
NovaForge evaluation panel during play. The chess-piece move sound is enabled by
default and can be muted from the lobby. During a game, Previous, Next, and Live
position controls, move-history buttons, and the Left/Right arrow keys let a player
review earlier positions without changing the live game. During an AI or online
game, future moves can be queued as unlimited premoves while the opponent is to
move. Each queued move is checked against the current position before it is sent
or played; stale premoves are discarded instead of being forced. The fair-play
terms and privacy policy are available as separate full-screen pages.

## Checks

Run the project's test suite with its single test command:

```bash
npm test
```

Optional JavaScript syntax validation:

```bash
for file in app.js chess.js engine.js engine-worker.js server.js auth.js rating.js premove.js; do
  node --check "$file"
done
```

## Docker

From the project's `chess-game/` directory, build and run the image with the
container listening on `PORT=8787` and the host/container ports mapped 1:1:

```bash
docker build -t nova-chess .
docker run --rm -p 8787:8787 \
  -e PORT=8787 \
  -e AUTH_DB_PATH=/app/data/nova-chess.sqlite \
  -v nova-chess-data:/app/data \
  nova-chess
```

Then use <http://127.0.0.1:8787/> and
<http://127.0.0.1:8787/health>. The image's health check uses the same internal
port. The named volume keeps SQLite account and rating data across container
replacements.

## Repository layout

```text
index.html                 Browser document and controls
styles.css                 Browser styling
app.js                     Browser UI, local modes, and online client
chess.js                   Legal move generation and game-state rules
engine.js                  NovaForge search and evaluation
engine-worker.js           Web Worker adapter for NovaForge
premove.js                 Preview and validation helpers for premoves
server.js                  HTTP assets, auth, friends, matchmaking, and WebSockets
auth.js                    SQLite accounts, sessions, friends, and ratings
rating.js                  Bullet, Blitz, Rapid, and variant Elo pools
engine.test.js             Engine-focused Node tests
smoke.test.js              Rules, perft, and engine smoke checks
server.test.js             HTTP, auth, friend, matchmaking, clock, and protocol tests
backend-persistence-matchmaking.test.js
                           SQLite persistence and random matchmaking tests
premove.test.js            Unlimited premove behavior tests
ui-contract.test.js        Active-game control checks
package.json               npm scripts and dependency declaration
package-lock.json          Locked npm dependency tree
README.md                 Project setup and operation notes
```
