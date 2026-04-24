# In the Loop — V2 Specs
*A real-time city scavenger hunt set in Chicago's Loop*

---

## 1. Overview

**Concept**: Teams compete across Chicago's Loop in a live, map-based challenge game. An admin pre-configures all challenges before the game — placing pins on a map, writing names and descriptions, and setting display order. Challenges appear in a queue: K challenges are active at a time, and when one is completed or expires, the next in order takes its slot. Teams travel to challenge locations, enter proximity range, and start challenges. Three challenge types create varied gameplay: **normal** (fixed tokens), **variable** (tokens per unit), and **wager** (risk your tokens for double reward).

**Core Rules**
- 5–7 teams, multiple devices per team
- All challenges created by admin during setup
- 3 challenge types: normal, variable, wager
- K challenges active at a time, expire after X minutes
- 1 active challenge per team at a time
- First team to complete a challenge claims it
- Honor system throughout
- Leaderboard always visible to all teams
- Team GPS never shown to other teams — only challenge start is broadcast

---

## 2. Data Models

### `Game`
```ts
interface Game {
  id: string;
  name: string;
  status: 'lobby' | 'active' | 'ended';
  durationMinutes: number;
  activeChallengeCount: number;        // K — how many challenges on the map at once
  challengeExpireMinutes: number;      // X — minutes before an active challenge expires
  startingTokens: number;              // initial token balance for every team (admin-set, e.g. 50)
  startTime: Date | null;              // set when admin starts game
  endTime: Date | null;                // computed: startTime + durationMinutes
  joinCode: string;                    // teams use this to join
  adminCode: string;                   // gates admin pages
  createdAt: Date;
}
```

### `Team`
```ts
interface Team {
  id: string;
  gameId: string;
  name: string;                        // unique within gameId
  color: string;                       // unique within gameId (from fixed palette)
  tokens: number;                      // current token balance — initialized to game.startingTokens
  activeChallengeId: string | null;    // the one challenge this team is working on
  wagerAmount: number | null;          // set when team starts a wager challenge (private to team)
  joinedAt: Date;
}
```

### `Challenge`
```ts
interface Challenge {
  id: string;
  gameId: string;

  // Content
  name: string;
  description: string;                // client-side visibility gating — see §3.3
  type: 'normal' | 'variable' | 'wager';

  // Tokens (type-dependent — enforced by DB CHECK constraint, see §4.6)
  //   normal:   tokens required; tokensPerUnit, unitLabel NULL
  //   variable: tokensPerUnit + unitLabel required; tokens NULL
  //   wager:    all three NULL (team picks amount at wager-set time)
  tokens: number | null;
  tokensPerUnit: number | null;
  unitLabel: string | null;

  // Location
  lat: number;
  lng: number;
  proximityMeters: number;            // activation radius

  // Queue
  sortOrder: number;                  // admin-set, determines queue sequence

  // Runtime
  status: 'queued' | 'active' | 'claimed' | 'expired';
  activatedAt: Date | null;           // when this challenge appeared on the map
  claimedByTeamId: string | null;
  claimedAt: Date | null;
}
```

### `LocationHistory`
```ts
interface LocationHistory {
  id: string;
  teamId: string;
  gameId: string;
  lat: number;
  lng: number;
  recordedAt: Date;
}
```
Stores computed team positions (averaged across devices), not individual device pings.

### `GameEvent`
```ts
interface GameEvent {
  id: string;
  gameId: string;
  type: GameEventType;
  payload: Record<string, unknown>;
  createdAt: Date;
}

type GameEventType =
  | 'game:started'
  | 'game:ended'
  | 'team:created'
  | 'team:reassigned'      // { deviceId, fromTeamId, toTeamId }
  | 'challenge:spawned'
  | 'challenge:started'
  | 'challenge:abandoned'
  | 'challenge:claimed'    // { challengeId, teamId, teamName, tokensAwarded, wagerAmount? }
  | 'challenge:expired'
  | 'challenge:wagerFailed'; // { challengeId, teamId, wagerAmount }
```
Append-only log for admin event feed and post-game stats. Written on every corresponding broadcast.

### In-Memory State

```ts
// deviceId → team membership (populated on game:join, updated on admin reassign).
// A device can only be in one game at a time — opening a new game replaces the entry.
const deviceTeam = new Map<string, { gameId: string; teamId: string }>();

// deviceId → connected sockets (for targeted emits on admin reassign).
// One device may have multiple sockets (e.g. open tabs); at most a few per device.
const deviceSockets = new Map<string, Set<Socket>>();

// Latest ping from each device, keyed by deviceId (random UUID from localStorage).
// RETAINED after the game ends for post-game data analysis/viz.
const devicePings = new Map<string, {
  teamId: string;
  gameId: string;
  lat: number;
  lng: number;
  updatedAt: Date;
}>();

// Expiration timers for active challenges, keyed by challengeId (globally unique).
const challengeTimers = new Map<string, NodeJS.Timeout>();

// Per-game end timers (supports multiple concurrent games on one server).
const gameEndTimers = new Map<string, NodeJS.Timeout>();

// Per-game admin position broadcast intervals.
const adminPositionIntervals = new Map<string, NodeJS.Timeout>();
```

On `game:join { gameId, teamId, deviceId }`, the server:
1. Verifies the team exists in this game
2. Sets `deviceTeam.set(deviceId, { gameId, teamId })`
3. Adds the socket to `deviceSockets[deviceId]`
4. Joins the socket to `game:{gameId}` and `team:{teamId}` rooms

On socket disconnect, removes the socket from `deviceSockets[deviceId]` (but preserves `deviceTeam` — the device is still logically on the team, just temporarily offline).

On admin reassign: updates `deviceTeam[deviceId].teamId`, moves every socket in `deviceSockets[deviceId]` out of the old team room into the new one, emits fresh `team:state` to each.

**Computing team position** (on demand, not stored):
```ts
function getTeamPosition(teamId: string): { lat: number; lng: number } | null {
  const cutoff = Date.now() - 30_000; // 30 second window
  const activePings = [...devicePings.values()]
    .filter(p => p.teamId === teamId && p.updatedAt.getTime() > cutoff);
  if (activePings.length === 0) return null;
  return {
    lat: avg(activePings.map(p => p.lat)),
    lng: avg(activePings.map(p => p.lng)),
  };
}
```

---

## 3. Flows

### 3.1 Game Lifecycle

```
Admin creates game (settings + challenges)
         │
         ▼
      LOBBY ──── teams join via joinCode, admin creates challenges
         │
         ▼
   Admin starts game
         │
         ▼
      ACTIVE ─── first K challenges activated, game timer starts
         │
         ▼
   Timer expires OR admin force-ends
         │
         ▼
      ENDED ──── final standings shown
```

- **Lobby**: admin creates/edits challenges on the map, reorders the queue. Teams join. Game cannot start until ≥ 1 challenge and ≥ 1 team.
- **Active**: challenge timers running, socket events flowing. All connected clients receive real-time updates.
- **Ended**: all challenge timers cleared. Final leaderboard displayed. Game is read-only.

### 3.2 Join Flow

```
Enter join code
     │
     ▼
  See lobby (list of teams)
     │
     ├── Create new team (name + color)
     └── Join existing team
            │
            ▼
   Wait for game start ──→ transition to map view
```

- Multiple devices join the same team via the same flow (pick same team)
- Each device generates a random UUID on first load → stored in `localStorage` as `deviceId`
- Devices on a team are anonymous — no individual identity
- All devices on a team share the same game state via socket rooms

**Switching teams:**
- **During lobby**: free switching — pick a team, tap a different team, repick. Choice is not locked until the game starts.
- **During active game**: self-switch is forbidden (too much state to migrate). If a device joined the wrong team by mistake, the admin can reassign it via the admin dashboard — server updates the device's `teamId`, emits fresh `team:state` to that device.

### 3.3 Challenge Flow (Team Perspective)

- **Challenge pin appears on map**
  - **Out of range** — see: name, type badge, tokens/rate, distance, expiration countdown. Description HIDDEN.
  - **In range** — description revealed + **Accept** button
    - Team must have no active challenge to start
    - **Accept** → `team.activeChallengeId` is set → branches by challenge type:
      - **Normal**
        - **Claim** → tokens awarded → challenge claimed → done
        - **Abandon** → no penalty, team freed
      - **Variable**
        - **Claim** → enter count ≥ 1 (e.g., "How many pushups?") → tokens = count × tokensPerUnit → challenge claimed → done. Server rejects count < 1.
        - **Abandon** → no penalty, team freed
      - **Wager**
        - **Abandon** (before setting wager amount) → no penalty, team freed
        - **Set wager amount** (min 1, max current tokens, must have ≥ 1 token) → `team.wagerAmount` set → team locked in, cannot abandon
          - **Pass** → tokens += 2 × wagerAmount → challenge claimed → done
          - **Fail** → tokens −= wagerAmount → challenge stays active for other teams (NOT claimed)

Tokens are never debited at wager-set time. `wagerAmount` is a UI hint only; the balance changes only on Pass/Fail.

#### Description Visibility

Descriptions are included in `game:state` and `challenge:spawned` payloads for all active challenges. Visibility is gated purely client-side:

| State | Description |
|---|---|
| Not started + out of range | HIDDEN |
| Not started + in range | REVEALED |
| Accepted (any proximity) | REVEALED — stays visible while performing the challenge |
| Abandoned | reverts to proximity-based rule above |

No server-side gating. Honor system; trust clients.

#### Getting Yanked
When another team claims a challenge or it expires, any team whose `activeChallengeId` points to it is yanked:
- Server emits `challenge:yanked { challengeId, reason: 'claimed' | 'expired' }` to the team room
- `activeChallengeId` is cleared; `wagerAmount` (if any) is cleared
- Tokens are untouched — nothing was debited on wager-set
- Same event covers the "I hit Complete but lost the race by 50ms" case (atomic UPDATE returned 0 rows)

---

## 4. Backend Architecture

### 4.1 Socket Room Architecture

Three room types, each client joins the appropriate rooms on connect:

```
game:{gameId}     All clients in this game (all teams + admin)
                  Receives: challenge spawned/claimed/expired, leaderboard updates,
                            challenge started/abandoned, game start/end

team:{teamId}     All devices on this team
                  Receives: challenge yanked, complete result, wager result,
                            team-private state (wagerAmount)

admin:{gameId}    Admin clients only
                  Receives: computed team GPS positions (every 5s)
```

**On client connect:**
- **Player client** emits `game:join { gameId, teamId, deviceId }`
  1. Server joins socket to `game:{gameId}` and `team:{teamId}` rooms
  2. Server emits `game:state` (public snapshot) to the socket
  3. Server emits `team:state` (private: wagerAmount, tokens, activeChallengeId) to the team room
- **Admin client** emits `admin:join { gameId, adminCode }`
  1. Server validates `adminCode` against the game row; rejects on mismatch
  2. Server joins socket to `game:{gameId}` and `admin:{gameId}` rooms
  3. Server emits `game:state` to the socket (same snapshot, plus admin-only fields if any)

**On client disconnect:**
- Socket.io automatically removes the socket from all rooms
- Device ping stays in `devicePings` map (auto-excluded after 30s inactivity)

**On client reconnect:**
- Socket.io reconnects automatically
- Client re-emits `game:join` → re-joins rooms → gets fresh `game:state` + `team:state`
- No event replay needed — snapshot is the full current state

### 4.2 State Synchronization

**Single source of truth: the server.**

Clients are read-only views. They never mutate state directly — they send action events to the server, which validates, applies the mutation (in DB + memory), and broadcasts the result.

```
Client A ──── action event ────→ Server ──── validates ────→ DB mutation
                                   │
                                   ├── broadcast result to game room
                                   ├── emit private result to team room
                                   └── update in-memory state
                                   │
Client A ◄─── result event ───────┘
Client B ◄─── result event ───────┘
Client C ◄─── result event ───────┘
```

**No client-side state mutation.** The client's Zustand store is updated ONLY in response to server events. This guarantees all clients converge to the same state.

**Snapshot on join/reconnect:** `game:state` gives the client the full current state in one message. No need to replay event history. If a client was disconnected for 5 minutes, it gets the current state on reconnect — not 5 minutes of buffered events.

### 4.3 Concurrency & Data Races

**Node.js is single-threaded, but `await` yields the event loop.** Two synchronous blocks in the same handler are atomic. But once a handler `await`s a DB query, a second handler can interleave. So the naive pattern (`read → check → await → write`) is NOT race-free.

**Defacto rule**: any state transition that has a check-then-write shape **must** be expressed as one atomic SQL statement with `WHERE` predicates that encode the precondition. If the `RETURNING` clause comes back empty, the precondition failed → reject.

**Atomic transitions used in this spec:**

```sql
-- Accept a challenge (team has no active challenge AND challenge is still active)
UPDATE teams
SET active_challenge_id = $1
WHERE id = $2
  AND active_challenge_id IS NULL
  AND EXISTS (SELECT 1 FROM challenges WHERE id = $1 AND status = 'active')
RETURNING *;

-- Claim a challenge (challenge is still active)
UPDATE challenges
SET status = 'claimed', claimed_by_team_id = $1, claimed_at = NOW()
WHERE id = $2 AND status = 'active'
RETURNING *;

-- Set wager amount (wager type, still started but no amount set)
UPDATE teams
SET wager_amount = $1
WHERE id = $2 AND active_challenge_id = $3 AND wager_amount IS NULL
RETURNING *;

-- Start game (game is in lobby)
UPDATE games
SET status = 'active', start_time = NOW(), end_time = NOW() + ($1 || ' minutes')::interval
WHERE id = $2 AND status = 'lobby'
RETURNING *;
```

In every case: 0 rows returned → the precondition failed (someone beat you, already in wrong state, etc.) → emit the appropriate rejection or yanked event.

**Concrete race scenarios:**

- *Two devices on the same team tap Accept*: both UPDATEs target the same row; PostgreSQL serializes them. First: 1 row returned → success. Second: predicate `active_challenge_id IS NULL` now fails → 0 rows → reject with "team already has an active challenge."
- *Two teams tap Complete on the same challenge*: both UPDATEs target the challenge row. First: 1 row returned → claim wins. Second: 0 rows → emit `challenge:yanked { reason: 'claimed' }` to that team.
- *For wager challenges on the race loss*: tokens are untouched (never debited at wager-set); `wagerAmount` is cleared.

**Defensive handling of late-arriving actions**: even with atomic SQL, a client may emit `challenge:fail` or `challenge:complete` for a challenge they've already been yanked off. Every handler starts by checking `team.activeChallengeId === payload.challengeId`; if not, drop silently.

**No locks, no Redis, no distributed consensus.** Single Node.js process + atomic SQL is sufficient for this scale.

### 4.4 Event-Driven Challenge Lifecycle

No polling ticker for game state. Challenge lifecycle is driven by `setTimeout` timers and action events.
(One exception: admin GPS broadcasts use a 5s `setInterval`. See §4.5.)

**When a challenge activates** (game start or queue fill):
```ts
const msUntilExpire = game.challengeExpireMinutes * 60 * 1000;
const timer = setTimeout(() => expireChallenge(challengeId), msUntilExpire);
challengeTimers.set(challengeId, timer);
// Set status='active', activatedAt=now in DB
// Broadcast challenge:spawned to game room
```

**When a challenge is claimed** (team completes it):
```ts
// Atomic: UPDATE challenges SET status='claimed', claimed_by_team_id=$1, claimed_at=NOW()
//        WHERE id=$2 AND status='active' RETURNING *
// If no row returned: race lost → emit challenge:yanked { reason: 'claimed' } to this team, return
clearTimeout(challengeTimers.get(challengeId));
challengeTimers.delete(challengeId);
// Award tokens to claiming team:
//   normal: team.tokens += challenge.tokens
//   variable: team.tokens += count * challenge.tokensPerUnit
//   wager: team.tokens += 2 * team.wagerAmount
// Clear claiming team's activeChallengeId and wagerAmount
// Yank all OTHER teams whose activeChallengeId = this challenge
// Broadcast challenge:claimed + leaderboard:update to game room
// Emit team:state to claiming team's room
fillQueue(gameId); // immediately activate next queued challenge
```

**When a challenge expires** (timer fires):
```ts
challengeTimers.delete(challengeId);
// Set status='expired' in DB
// Clear activeChallengeId + wagerAmount on all teams working on it (no token change)
// Emit challenge:yanked { reason: 'expired' } to each affected team room
// Broadcast challenge:expired to game room
fillQueue(gameId); // immediately activate next queued challenge
```

**When a wager fails** (team self-reports failure):
```ts
// team.tokens -= team.wagerAmount
// Clear team.activeChallengeId and team.wagerAmount
// Challenge stays active (NOT claimed, NOT expired) — its timer keeps running, other teams can still claim
// Broadcast challenge:wagerFailed + leaderboard:update to game room
// Emit team:state to failing team's room
// No queue action — challenge is still on the map
```

**Queue fill (atomic, one SQL statement):**
```sql
-- Activate the next N queued challenges in one atomic statement,
-- where N = activeChallengeCount - current active count.
-- No race window even if called from concurrently-resolving timers.
UPDATE challenges
SET status = 'active', activated_at = NOW()
WHERE id IN (
  SELECT id FROM challenges
  WHERE game_id = $1 AND status = 'queued'
  ORDER BY sort_order
  LIMIT GREATEST(0, $2::int - (
    SELECT COUNT(*) FROM challenges
    WHERE game_id = $1 AND status = 'active'
  ))
)
RETURNING *;
```

Server-side after the statement returns:
```ts
for (const ch of returnedRows) {
  const timer = setTimeout(() => expireChallenge(ch.id), game.challengeExpireMinutes * 60_000);
  challengeTimers.set(ch.id, timer);
  io.to(`game:${gameId}`).emit('challenge:spawned', { challenge: ch });
}
```

If the queue is drained (`returnedRows.length < needed`), the game simply runs with fewer active challenges.

**Game start:**
```ts
// Atomic: UPDATE games SET status='active', start_time=NOW(),
//         end_time=NOW()+(durationMinutes||' minutes')::interval
//         WHERE id=$1 AND status='lobby' RETURNING *
// If 0 rows: game already started or ended → reject
// Initialize every team's tokens to game.startingTokens
// Activate first K challenges (fillQueue — atomic)
gameEndTimers.set(gameId, setTimeout(() => endGame(gameId), durationMinutes * 60_000));
// Start the admin position broadcast interval for this game
adminPositionIntervals.set(gameId, setInterval(() => broadcastPositions(gameId), 5000));
// Broadcast game:started to game room
```

**Game end** (timer fires or admin force-ends):
```ts
// Clear this game's challenge timers
for (const ch of activeChallengesInGame(gameId)) {
  clearTimeout(challengeTimers.get(ch.id));
  challengeTimers.delete(ch.id);
}
clearTimeout(gameEndTimers.get(gameId));
gameEndTimers.delete(gameId);
clearInterval(adminPositionIntervals.get(gameId));
adminPositionIntervals.delete(gameId);
// Set game.status='ended', game.end_time=NOW() in DB (force-end case rewrites end_time).
// Clear activeChallengeId and wagerAmount on all teams in this game.
// Broadcast game:ended with final standings (teams sorted by tokens DESC, name ASC).
//
// NOTE: devicePings and location_history rows are NOT cleaned up — they're retained
// for post-game data analysis and visualization.
```

### 4.5 Admin Position Broadcasts (the one polling interval)

**Player clients render their own GPS dots locally** (via `navigator.geolocation`) — no server round-trip. Proximity checks are also client-side per-device. Server-side positions are **admin-only**.

Admin clients need to see all team positions on their map. Rather than emit on every `location:update`, the server runs a single 5s `setInterval` per active game:

```ts
function broadcastPositions(gameId: string) {
  const positions: { teamId: string; lat: number; lng: number }[] = [];
  for (const teamId of teamsInGame(gameId)) {
    const pos = getTeamPosition(teamId); // averaged from devicePings, 30s window
    if (pos) positions.push({ teamId, ...pos });
  }
  io.to(`admin:${gameId}`).emit('teams:positions', { positions });

  // Also append each team's computed position to LocationHistory for post-game analysis.
  for (const p of positions) {
    db.query(
      `INSERT INTO location_history (team_id, game_id, lat, lng, recorded_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [p.teamId, gameId, p.lat, p.lng]
    );
  }
}
```

This is read-only for the admin broadcast; `LocationHistory` is an append-only insert (one row per team per tick). Interval is started in `startGame`, cleared in `endGame` / on server shutdown.

### 4.6 Database Constraints

Wherever possible, encode invariants in SQL so the DB enforces correctness even if application code forgets.

```sql
-- Challenge field shape per type
ALTER TABLE challenges ADD CONSTRAINT challenge_type_fields CHECK (
  (type = 'normal'   AND tokens IS NOT NULL AND tokens_per_unit IS NULL AND unit_label IS NULL) OR
  (type = 'variable' AND tokens IS NULL AND tokens_per_unit IS NOT NULL AND unit_label IS NOT NULL) OR
  (type = 'wager'    AND tokens IS NULL AND tokens_per_unit IS NULL AND unit_label IS NULL)
);

-- Team name/color unique within a game
ALTER TABLE teams ADD CONSTRAINT team_name_unique_per_game  UNIQUE (game_id, name);
ALTER TABLE teams ADD CONSTRAINT team_color_unique_per_game UNIQUE (game_id, color);

-- Wager is only set on wager-type challenges, only while started
-- (enforced in application code; DB can't cross-check easily)
```

### 4.7 Server Recovery (restart)

If the server process restarts mid-game, in-memory state (timers, device pings) is lost. Recovery on startup:

```ts
// For each game with status='active':
// 1. If now >= game.endTime: run endGame(gameId) immediately and skip the rest.
//    Otherwise: gameEndTimers.set(gameId, setTimeout(..., endTime - now))
// 2. For each challenge with status='active':
//    - Compute remaining expire time (activatedAt + expireMinutes - now)
//    - If already expired: run expireChallenge immediately
//    - If still active: set setTimeout for remaining time
// 3. Run fillQueue to catch up on any missed fills
// 4. Start admin position broadcast setInterval for this game
// 5. Device pings are lost — clients will re-ping within 5 seconds
```

---

## 5. Real-Time Protocol

### 5.1 Client → Server

```ts
'game:join'              { gameId, teamId, deviceId }                   // player clients
'admin:join'             { gameId, adminCode }                          // admin clients
'location:update'        { deviceId, teamId, lat, lng }
'challenge:start'       { challengeId, teamId }                        // any type; no wager yet
'challenge:wager'        { challengeId, teamId, wagerAmount }           // wager type only: locks in amount
'challenge:complete'     { challengeId, teamId, count?: number }        // count for variable (≥1); no count for normal/wager
'challenge:fail'         { challengeId, teamId }                        // wager only: self-report failure
'challenge:abandon'      { challengeId, teamId }                        // any type, before wager lock-in for wager type
```

**All action events use Socket.io acks** so the client gets explicit success/failure without relying on indirect broadcasts:

```ts
type ActionAck =
  | { ok: true }
  | { ok: false, reason: 'team_busy' | 'challenge_unavailable' | 'invalid_state' | 'bad_input' };

// Client
socket.emit('challenge:start', payload, (ack: ActionAck) => {
  if (!ack.ok) showToast(toastCopy[ack.reason]);
});

// Server
socket.on('challenge:start', async (payload, ack) => {
  const row = await db.query(ATOMIC_ACCEPT_SQL, [...]);
  if (row.rowCount === 0) return ack({ ok: false, reason: 'team_busy_or_challenge_unavailable' });
  // ... broadcast, etc.
  ack({ ok: true });
});
```

Ack reasons by event:
- `challenge:start` → `team_busy` (team already has an active challenge) / `challenge_unavailable` (claimed or expired before your tap landed)
- `challenge:wager` → `invalid_state` (team isn't on this challenge) / `bad_input` (wagerAmount out of range)
- `challenge:complete` → `challenge_unavailable` (race lost) / `invalid_state` (not your team's active) / `bad_input` (count < 1 for variable)
- `challenge:fail` / `challenge:abandon` → `invalid_state` (not your team's active, or abandon-after-wager)

`location:update` does not ack (fire-and-forget telemetry).

### 5.2 Server → Game Room (`game:{gameId}`)

```ts
'game:started'           { game: Game, challenges: Challenge[] }   // includes the K activated challenges so clients sync in one event
'game:ended'             { finalStandings: { teamId, name, color, tokens, rank }[] }
'challenge:spawned'      { challenge: Challenge }             // new challenge activated from queue (includes description — client gates visibility)
'challenge:claimed'      { challengeId, teamId, teamName, tokensAwarded }
'challenge:expired'      { challengeId }
'challenge:started'     { challengeId, teamId }              // a team started working on a challenge
'challenge:abandoned'    { challengeId, teamId }
'challenge:wagerFailed'  { challengeId, teamId }              // a team failed their wager (challenge stays active)
'leaderboard:update'     { teams: { id, name, color, tokens, rank }[] }
```

### 5.3 Server → Team Room (`team:{teamId}`)

```ts
'challenge:yanked'       { challengeId, reason: 'claimed' | 'expired' }  // covers passive yank AND lost-race on Complete
'complete:success'       { challengeId, tokensAwarded: number }          // variable/normal claim, or wager pass
'wager:result'           { challengeId, outcome: 'pass' | 'fail', tokensDelta: number }
'team:state'             { activeChallengeId, wagerAmount, tokens }      // fires any time private state changes
```

### 5.4 Server → Admin Room (`admin:{gameId}`)

```ts
'teams:positions'        { positions: { teamId, lat, lng }[] }    // emitted every 5 seconds
```

**Admin derives per-team `activeChallengeId` from game-room broadcasts**, since `team:state` is team-scoped and admins don't join team rooms. On receipt of a game-room event, the admin client updates its local `teams[]`:

| Event | Admin client action |
|---|---|
| `challenge:started { challengeId, teamId }` | `teams[teamId].activeChallengeId = challengeId` |
| `challenge:abandoned { challengeId, teamId }` | `teams[teamId].activeChallengeId = null` |
| `challenge:claimed { challengeId, teamId, … }` | clear `activeChallengeId` on that team + any other team that had it set to this challenge; apply tokens delta |
| `challenge:expired { challengeId }` | clear `activeChallengeId` on any team that had it set to this challenge |
| `challenge:wagerFailed { challengeId, teamId }` | `teams[teamId].activeChallengeId = null` |

### 5.5 Server → Joining Client (on connect/reconnect)

```ts
// Public state (via game:state)
'game:state'             {
                           game: Game,
                           teams: { id, name, color, tokens, activeChallengeId }[],
                           challenges: Challenge[]   // active challenges only; descriptions included, client gates visibility
                         }

// Private state (via team:state, to team room)
'team:state'             { activeChallengeId, wagerAmount, tokens }
```

---

## 6. REST API

All admin endpoints require `adminCode` in the `x-admin-code` header.

```
POST   /api/games                           Create game (returns game with adminCode)
GET    /api/games?joinCode=XXXX             Lookup game by join code (public fields only)
GET    /api/games/:id                       Get game

POST   /api/games/:id/teams                 Create team (name, color) — LOBBY ONLY
GET    /api/games/:id/teams                 List teams

POST   /api/games/:id/challenges            Create challenge (admin) — LOBBY ONLY
GET    /api/games/:id/challenges            List all challenges (admin)
PUT    /api/challenges/:id                  Update challenge (admin) — LOBBY ONLY
DELETE /api/challenges/:id                  Delete challenge (admin) — LOBBY ONLY
PUT    /api/games/:id/challenges/order      Reorder challenges (admin) — LOBBY ONLY, body: [{ id, sortOrder }]

POST   /api/games/:id/start                Start game (admin)
POST   /api/games/:id/end                  Force end game (admin)

GET    /api/games/:id/events               List game events (admin, for event log)
POST   /api/games/:id/reassign-device      Move a device to another team (admin)
                                           — body: { deviceId, newTeamId }
                                           — only allowed while game.status='active'
```

**Mutation lockdown**: once `game.status='active'`, the admin cannot edit the game settings, create/edit/delete/reorder challenges, or create new teams. Only two admin actions remain: **force-end** and **reassign-device**. Server enforces by checking `game.status` on every lobby-only endpoint and returning 409 Conflict if out of phase.

**Post-game reload**: after `game:ended`, if a player or admin reloads, the normal `game:state` snapshot (with `game.status='ended'` and the frozen `teams[]` sorted by tokens) is enough — final standings are derivable. No separate "final standings" fetch needed.

**Color palette**: the 7-color team palette is hardcoded client-side (`TEAM_COLORS` in `JoinPage.tsx`). The Create Team endpoint validates `color ∈ palette` and rejects colors already taken in the game.

**Auth code generation**:
- `joinCode`: 4-char uppercase alphanumeric (e.g. `A7FQ`). Retry on UNIQUE-constraint collision.
- `adminCode`: 16-char random (`crypto.randomBytes(12).toString('base64url')`). Collision negligible.

**Post-game reload**: after `game:ended`, if a player or admin reloads, the normal `game:state` snapshot (with `game.status='ended'` and the frozen `teams[]` sorted by tokens) is enough — final standings are derivable. No separate "final standings" fetch needed.

**Color palette**: the 7-color team palette is hardcoded client-side (`TEAM_COLORS` in `JoinPage.tsx`). The Create Team endpoint validates `color ∈ palette` and rejects colors already taken in the game.

---

## 7. Admin Dashboard (brief)

- **URL**: `/game/:gameId/admin`, gated by `adminCode` in localStorage
- **Setup** (lobby): game settings (duration, K, X, starting tokens), map-based challenge creation, drag-to-reorder challenge queue
- **Live** (active): admin map with team positions, challenge status list, event log, force-end button, **device reassignment tool** (move a device from one team to another if someone joined the wrong team)
- **Post-game** (ended): final leaderboard, event log (read-only)

---

## 8. Frontend (brief — defer detailed design)

- MapLibre GL JS + Protomaps PMTiles, custom dark style
- Zustand store updated only by server events (never by client actions directly)
- Challenge pins on map with type badges, proximity rings
- HUD: game timer, leaderboard, active challenge card
- Routes: `/join`, `/game/:gameId`, `/game/:gameId/admin`, `/game/:gameId/end`

**Location & proximity (per-device, client-side):**
- Each device renders its own GPS dot via `navigator.geolocation.watchPosition`
- Proximity to a challenge pin is computed locally (haversine on the device's current GPS) — no server round-trip, no broadcast lag
- A device also emits `location:update` to the server every 5s so `devicePings` + `LocationHistory` stay fresh (server-side GPS is admin-only)
- Server never broadcasts positions to player clients

---

## 9. Tech Stack: Choices & Alternatives

Each technology choice, why it's here, and what you could swap it for.

### 9.1 Project Structure: Monorepo (npm workspaces)

**Why**: shared types between server and client. Change a type once, both sides see it.

**Alternatives**:
- **Single package** — one `package.json`, `src/server/` + `src/client/` + `src/shared/` directories. Simpler, no workspace config. Works fine at this scale. Downside: server deps (pg, express) and client deps (react, vite) in one package.json.
- **Turborepo / Nx** — caching + task orchestration on top of workspaces. Overkill here.

### 9.2 Server Framework: Express

**Why**: simple, well-known, ~10 REST endpoints.

**Alternatives**:
- **Hono** — lighter (~14KB), modern API, built-in TypeScript. Good fit if starting fresh.
- **Fastify** — faster, schema-based validation. More opinionated.
- **No framework (raw `http`)** — only ~10 endpoints. Could use raw `http.createServer` + a simple router. Loses middleware (CORS, JSON parsing, error handling).
- **Everything over WebSocket** — skip REST entirely, do all CRUD via socket events. One transport, but harder to debug (no curl), no HTTP semantics.

### 9.3 Real-Time: Socket.io

**Why**: auto-reconnection, rooms (game room + team room + admin room), message serialization. Rooms are used heavily in this design.

**Alternatives**:
- **Native WebSocket (`ws`)** — lighter, no abstraction. But you build: reconnection, room management, serialization. Real work for features Socket.io gives free.
- **SSE + HTTP POST** — server pushes via SSE, client acts via POST. Simpler mental model. No built-in rooms, two transports.
- **PartyKit** — WebSocket framework with rooms. Hosted service (not self-hosted).

### 9.4 Database: PostgreSQL

**Why**: ACID for atomic claims, relational model fits, permanent location history.

**Alternatives**:
- **SQLite** — no separate process, single file, simpler deploy. `better-sqlite3` is synchronous and fast. Atomic claim works (`UPDATE ... WHERE status='active' RETURNING *`). For 5–7 teams, concurrency is a non-issue. Biggest simplification on the list.
- **In-memory only** — JS objects/Maps. Simplest. But no persistence across restarts, no post-game stats.

### 9.5 Database Access: Raw SQL (`pg`)

**Why**: full control, no ORM magic, easy to understand.

**Alternatives**:
- **Drizzle** — lightweight TS-native query builder/ORM. Schema in TS, auto-generated migrations. Less boilerplate.
- **Kysely** — type-safe SQL query builder (not ORM). SQL-like chains, full TS inference.
- **Prisma** — full ORM. Heavier, probably overkill.

### 9.6 Client: React + Vite + Zustand

**Why**: component model, Zustand `getState()`/`setState()` callable from socket handlers outside React.

**Alternatives**:
- **Preact** — React-compatible, 3KB. Drop-in replacement, no downside.
- **Svelte** — less boilerplate, smaller bundle. MapLibre integration less mature.
- **React Context + useReducer** — no dependency, but updating from socket handlers requires a ref/event bridge.

### 9.7 Map: MapLibre GL JS + Protomaps PMTiles

No real alternatives for self-hosted vector tiles. This is the right choice.

### 9.8 Reverse Proxy: nginx

**Why**: TLS termination, reverse proxy, static file serving.

**Alternatives**:
- **Caddy** — auto-TLS (zero-config Let's Encrypt), simpler config (~5 lines vs nginx's ~40). Worth considering.
- **Node serves everything** — skip reverse proxy. Simpler (one process), but Node is slower at static files and TLS setup is manual.

### 9.9 Process Manager: pm2 vs systemd

- **pm2** — Node-specific, easy (`pm2 start server.js`), auto-restart, log management.
- **systemd** — OS-level, no extra dependency, already on VPS.

Either works.

---

## 10. Resolved Decisions

| Question | Answer |
|---|---|
| Teams | 5–7 |
| Devices per team | Multiple — anonymous, same join flow |
| Team location (admin view) | Average of latest ping from each device active in last 30s, broadcast to admin room every 5s |
| Team location (player view) | Each device renders its own GPS via `navigator.geolocation` — no server round-trip. Proximity checks are per-device, client-side. |
| Team location visibility | Player GPS never broadcast to other teams. Only `challenge:started` is broadcast. Admin sees averaged team positions via admin room. |
| Device identity | Random UUID in localStorage (`deviceId`) |
| Challenge types | Normal (fixed tokens), variable (tokens/unit), wager (bet your tokens) |
| Challenge visibility | Name, type, tokens/rate, distance, expiration always visible. Description: see §3.3 "Description Visibility" table. |
| Starting tokens | `game.startingTokens`, admin-set at game creation (default suggestion: 50) |
| Team switching | Free in lobby. During active game: admin can reassign a device to another team, but players cannot self-switch. |
| Team name + color uniqueness | Both unique within a game, enforced by DB UNIQUE constraint. Color picked from fixed 7-color palette. |
| Data retention | `devicePings` + `location_history` retained after game end for post-game analysis/viz |
| Tokens — normal | Fixed at creation |
| Tokens — variable | count × tokensPerUnit, team enters count on completion |
| Tokens — wager | Pass = +2× wager, fail = −wager. Min wager = 1, max = current tokens |
| Wager lock-in | Cannot abandon once wager is set. Must pass or fail. |
| Wager fail | Does NOT claim the challenge — it stays active for others |
| Wager — yanked/expired | `wagerAmount` cleared; tokens untouched (never debited on wager-set) |
| Proximity radius | Per-challenge, admin-set slider (50–300m) |
| Active challenge limit | 1 per team at a time |
| Claim mechanic | Honor system, first to complete claims it |
| Multiple teams on same challenge | Yes — first to complete wins |
| Location ping frequency | 5s per device |
| Location history | Computed team position saved to DB every 5s |
| Challenge lifecycle | Event-driven (setTimeout per challenge), not polling ticker |
| State sync | Server is single source of truth. Clients updated via socket events only. game:state snapshot on connect/reconnect. |
| Concurrency | Single-threaded Node.js + atomic SQL. No locks/Redis needed. |
| Socket rooms | game:{gameId} (all), team:{teamId} (private), admin:{gameId} (admin GPS) |
| Leaderboard | Always visible to all teams |
| Challenge ordering | `sortOrder` — admin drag-to-reorder |
| Challenge expiration | Per game (X minutes), event-driven timeout |
| Active challenge count | K on map at once, set per game |
| Active challenge tracking | `activeChallengeId` on team row |
| Wager tracking | `wagerAmount` on team row (private, team room only) |
| Database | PostgreSQL, raw SQL via `pg` (no ORM) |
| Auth | None — admin code in localStorage |
| Admin mutations during active game | Locked out. Only force-end + reassign-device allowed. All challenge/team/settings mutations are lobby-only. |
| Variable count validation | Server rejects `count < 1` |
| Force-end `endTime` | Set to `NOW()` (actual end time, not planned) |
| Leaderboard tiebreaker | `tokens DESC, name ASC` |
| Auth code generation | `joinCode`: 4-char uppercase alphanumeric (retry on collision); `adminCode`: 16-char random |
| GameEvent types | Enumerated (see §2 `GameEventType`); one event row written per broadcast |
