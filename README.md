# Nova Chess

Nova Chess is a browser chess game with a custom local engine, same-browser
two-player games, and server-authoritative online invite rooms. The code remains
in this workspace's `chess-game/` directory. Start a shell in that directory
before running the relative commands below; they do not depend on a particular
machine path.

## Supported modes

- **Human vs. NovaForge (local AI):** play against the JavaScript engine in a
  Web Worker. Difficulty presets control the engine's search time and depth.
- **Local two-player:** two people can play from the same browser and device;
  no online room or second server connection is needed.
- **Online room:** create or join a room with an invite code. The Node server
  validates legal moves, maintains both clocks, and synchronizes the position
  over WebSocket.

### NovaForge strength disclaimer

NovaForge is a custom JavaScript chess engine. It does **not** use Stockfish,
Stockfish source code, Stockfish weights, or an opening book. It is a practical
first-build searcher, not a measured Stockfish replacement, and no Stockfish-level
strength or Elo rating is claimed. Its difficulty labels are local search
presets, not calibrated playing-strength ratings.

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

The server reads `PORT`, `HOST`, `ROOM_TTL_MS`, `CLOCK_INTERVAL_MS`, and
`MAX_PAYLOAD_BYTES` from the environment and falls back to the documented
defaults when a value is absent or invalid.

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

The server is the recommended local entry point for every mode. In particular,
Online room mode needs the HTTP server and its WebSocket endpoint; opening the
HTML file directly is not an online-room setup.

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

## Online rooms and WebSockets

Online room WebSockets must be same-origin with the page that opened them. Use
the browser URL served by this application, and have both players use the same
scheme, host, and port. The browser client automatically uses `ws://` for an
HTTP page and `wss://` for an HTTPS page; the server rejects a browser upgrade
whose origin does not match the request host and protocol.

Rooms are ephemeral and stored only in the running Node process's memory. There
is no database or room persistence: a process restart, crash, replacement, or
separate server instance loses its rooms, positions, and reconnect tokens.

## Checks

Run the project's test suite with its single test command:

```bash
npm test
```

Optional JavaScript syntax validation:

```bash
for file in app.js chess.js engine.js engine-worker.js server.js; do
  node --check "$file"
done
```

## Docker

From the project's `chess-game/` directory, build and run the image with the
container listening on `PORT=8787` and the host/container ports mapped 1:1:

```bash
docker build -t nova-chess .
docker run --rm -p 8787:8787 -e PORT=8787 nova-chess
```

Then use <http://127.0.0.1:8787/> and
<http://127.0.0.1:8787/health>. The image's health check uses the same internal
port.

## Repository layout

```text
index.html                 Browser document and controls
styles.css                 Browser styling
app.js                     Browser UI, local modes, and online client
chess.js                   Legal move generation and game-state rules
engine.js                  NovaForge search and evaluation
engine-worker.js           Web Worker adapter for NovaForge
server.js                  HTTP assets, /health, and WebSocket rooms
engine.test.js             Engine-focused Node tests
smoke.test.js              Rules, perft, and engine smoke checks
server.test.js             HTTP, room, clock, and protocol tests
package.json               npm scripts and dependency declaration
package-lock.json          Locked npm dependency tree
README.md                 Project setup and operation notes
```
