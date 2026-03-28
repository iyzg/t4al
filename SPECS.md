# In the Loop — Game Website Specs
*A real-time city scavenger hunt set in Chicago's Loop*

---

## 1. Overview

**Concept**: Teams compete across Chicago's Loop in a live, map-based challenge game. An admin pre-configures all challenges before the game: placing pins on a map, writing names and descriptions, assigning fixed point values, and setting display order. Challenges appear in a queue — K challenges are active at a time, and when one is completed or expires, the next in order takes its slot. Teams travel to challenge locations, activate them on arrival, complete them on the honor system, and the first team to mark complete wins the points.

**Confirmed Decisions**
- 5–7 teams, 1 device per team
- All challenges created by admin during setup — no templates
- Each challenge has a fixed point value set at creation (no accumulation)
- Challenges have a `sortOrder` — admin controls the sequence they appear in
- K challenges active at a time (`activeChallengeCount`, set per game)
- Challenges expire after X minutes (`challengeExpireMinutes`, set per game)
- When a challenge expires, it is removed from all teams and the next in queue activates
- Teams see a challenge pin but not the description until they set it active
- Teams can only activate a challenge when within the admin-set proximity radius
- Only 1 active challenge per team at a time (tracked via `activeChallengeId` on team)
- When a team activates a challenge, their pin appears at that challenge on the admin map
- First team to mark complete wins the points (honor system + confirmation dialog)
- Team locations never shown to other teams
- All location pings stored permanently in Postgres for post-game stats
- Leaderboard is always visible to all teams

**Tech Stack**
- Frontend: React + TypeScript
- Map: Protomaps (self-hosted PMTiles) + MapLibre GL JS
- Backend: Node.js + Express, hosted on Hetzner VPS (nginx for TLS/reverse proxy)
- Realtime: WebSockets via Socket.io
- Database: PostgreSQL

---

## 2. Infrastructure: Protomaps on Hetzner

Protomaps lets you serve a map as a single `.pmtiles` file from your own VPS — no Mapbox key, no per-tile costs.

**Setup**
- Download a Chicago extract (.pmtiles) from Protomaps
- Serve via HTTP range requests from Hetzner (any static file server works)
- Render with MapLibre GL JS and a custom style JSON
- Full visual control — colors, fonts, label density, road weights

---

## 3. Core Data Models

### `Game`
```ts
interface Game {
  id: string;
  name: string;
  status: 'lobby' | 'active' | 'ended';
  durationMinutes: number;              // game length; admin sets this at creation
  activeChallengeCount: number;         // K — how many challenges are active at once
  challengeExpireMinutes: number;       // challenges expire after this many minutes
  startTime: Date | null;               // set when admin starts the game
  endTime: Date | null;                 // computed: startTime + durationMinutes
  joinCode: string;
  adminCode: string;                    // secret code to access admin pages
  createdAt: Date;
}
```

### `Team`
```ts
interface Team {
  id: string;
  gameId: string;
  name: string;
  color: string;
  score: number;
  activeChallengeId: string | null;     // the one challenge this team is working on
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
  description: string;           // hidden until team activates
  points: number;                // fixed, set at creation

  // Location
  lat: number;
  lng: number;
  proximityMeters: number;       // admin-set activation radius

  // Queue order
  sortOrder: number;             // determines queue position; admin sets this

  // Runtime
  status: 'queued' | 'active' | 'claimed' | 'expired';
  activatedAt: Date | null;      // when this challenge became active (visible on map)
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

### `GameEvent`
```ts
interface GameEvent {
  id: string;
  gameId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}
```

---

## 4. Game Logic

### 4.1 Challenge Queue

Challenges are ordered by `sortOrder`. The game has an `activeChallengeCount` (K) — at game start, the first K challenges (by sort order) become `'active'` and appear on all team maps.

A background ticker checks every 10 seconds:
1. **Expiration check** — any active challenge whose `activatedAt + challengeExpireMinutes` has passed is expired. Status set to `'expired'`, all teams with it as their `activeChallengeId` have it cleared, and clients are notified.
2. **Fill check** — if fewer than K challenges are currently `'active'`, the next `'queued'` challenge (by sort order) is activated. Its `activatedAt` is set to now, status flipped to `'active'`, and all clients get a `challenge:spawned` event.

When a challenge is **claimed** or **expired**, the queue advances — the next queued challenge fills the slot. If no queued challenges remain, the game continues with fewer active challenges until the game ends.

### 4.2 Challenge Flow: Visible → Unlocked → Active → Complete

**Visible** — challenge is `'active'` (on the map), team not in range. Name + points shown, description hidden.

**Unlocked** — team enters proximity radius. "Set as Active?" prompt shown. Team must have no current active challenge.

**Active** — team taps "Set as Active." Description revealed. `team.activeChallengeId` set to this challenge. Team pin moves to challenge location on admin map. Team locked from activating another.

**Complete** — team taps "Mark as Complete." Confirmation dialog: *"Are you sure you completed this challenge?"* First to confirm wins the points. All clients get leaderboard update.

**Expired** — if the challenge expires while a team has it active, the challenge is yanked away. `team.activeChallengeId` cleared, team notified and free to activate another.

### 4.3 Abandoning a Challenge
Team can drop active challenge at any time, no penalty. `activeChallengeId` set to null. Frees them to activate another.

### 4.4 Location Tracking
```ts
// In-memory, overwritten each ping. Used for admin map display.
const currentPositions: Record<teamId, { lat, lng, updatedAt }> = {};
```
Every ping also writes a permanent row to `LocationHistory`. Heartbeat: 30 seconds.

---

## 5. Frontend: Map UI

### 5.1 Map Setup
- MapLibre GL JS rendering Protomaps PMTiles
- Custom dark style tuned for Chicago Loop
- All tiles from Hetzner VPS

### 5.2 Map Layer Stack (bottom → top)
1. Base map — Protomaps, custom styled
2. Challenge markers — pins per active challenge
3. My position — your team's GPS dot
4. Proximity ring — activation radius circle (shown when tapping a pin)

### 5.3 Challenge Marker States
| State | Visual |
|---|---|
| Active, no teams working | Default pin, name + points label |
| Teams working on it | Pie chart pin — slices in each team's color |
| In range | Highlighted ring, "Set as Active?" prompt |
| Your team active | Pin outlined in your team color (your slice in the pie if others are also there) |

Markers disappear from the map when a challenge is claimed or expires (with a brief animation). Proximity is determined client-side using GPS + haversine.

### 5.4 HUD
- **Top bar**: Game name, countdown to end
- **Leaderboard panel**: Always visible — name, color, score, rank
- **Challenge card** (on tap): name, points, description if active, CTAs (abandon / mark complete when active)

### 5.5 Views
- `/join` — Enter join code, land in lobby (see teams, create your own, then join)
- `/game/:gameId` — Main map
- `/game/:gameId/admin` — Admin dashboard with tabs: Setup + Live (requires admin code)
- `/game/:gameId/end` — Final leaderboard + stats

---

## 6. Admin Dashboard (`/admin`) — Tabbed

### Tab 1: Setup (pre-game)

**Game Settings**
- Game name
- Duration (minutes)
- Join code (auto-generated, editable)
- Admin code (secret code to access admin pages)
- Active challenge count (K)
- Challenge expire minutes (X)

**Challenge Creation (Map-First)**
Full-screen map of Chicago. Admin creates challenges directly:

1. **Click anywhere on the map** → challenge creation popover opens
2. Fill in:
   - **Name** — visible to teams before activation
   - **Description** — revealed only on activation
   - **Points** — fixed integer
   - **Activation radius** — slider (50–300m); shown as a live circle on the map
3. Save → pin drops, stays editable (click to reopen)
4. Drag pin to reposition

**Challenge Order**
A sortable list of all challenges. Admin drags to reorder — this sets `sortOrder`, which determines the queue sequence. Challenges at the top appear first when the game starts.

### Tab 2: Live (during game)

**Map**
- All team GPS positions, labeled by name + color
- Active challenge teams → pin at challenge location

**Challenge List**
- All challenges: status (queued/active/claimed/expired), claimer, claim time

**Controls**
- Force end game

**Live Event Log**
Timestamped feed: challenge spawned, challenge expired, team X activated Y, team X completed Y for Z pts, etc.

---

## 7. Real-Time (WebSockets)

### Client → Server
```ts
'location:update'        { teamId, lat, lng }
'challenge:activate'     { challengeId, teamId }
'challenge:abandon'      { challengeId, teamId }
'challenge:complete'     { challengeId, teamId }
'game:join'              { gameId, teamId }
```

### Server → All Clients
```ts
'challenge:spawned'      { challenge: Challenge }
'challenge:claimed'      { challengeId, claimedByTeam, points }
'challenge:expired'      { challengeId }
'challenge:activated'    { challengeId, teamId }    // team started working on a challenge
'challenge:abandoned'    { challengeId, teamId }    // team dropped a challenge
'leaderboard:update'     { teams: { id, name, color, score, rank }[] }
'game:ended'             { finalScores }
```

### Server → Joining Client (on connect/reconnect)
```ts
'game:state'             { game, teams: { id, name, color, score, activeChallengeId }[], challenges: Challenge[] }  // challenges = active only
```
Full state snapshot — client uses this to sync up regardless of missed events.

### Server → Team (private)
```ts
'challenge:yanked'       { challengeId }   // challenge expired while team had it active
'complete:success'       { challengeId, points }
'complete:failed'        { reason: 'already_claimed' | 'not_active' }
```

---

## 8. MVP vs. Phase 2

### MVP
- [ ] Join flow with team selection
- [ ] Admin dashboard: game settings, map-based challenge creation, sortable challenge order
- [ ] Protomaps + MapLibre GL JS, self-hosted on Hetzner
- [ ] Challenge queue system (K active, expiration, auto-advance)
- [ ] Challenge pin visibility, proximity unlock, activate flow (1 active per team)
- [ ] Fixed points, honor system complete with confirmation
- [ ] Admin live tab: map, challenge list, event log, force end
- [ ] Location history to Postgres
- [ ] Game end screen + final leaderboard

### Phase 2
- [ ] Claim burst animation (visual polish)
- [ ] Post-game stats: distance walked, challenge timeline, near misses
- [ ] Full replay animation + heatmaps
- [ ] Push notifications for nearby challenges
- [ ] Mobile-native wrapper (Capacitor)
- [ ] Cross-game stats dashboard

---

## 9. Resolved Decisions

| Question | Answer |
|---|---|
| Teams | 5–7 |
| Devices per team | 1 (captain's phone) |
| Challenge creation | Admin creates each one on the map — no templates |
| Challenge text visibility | Hidden until team activates |
| Points | Fixed at creation, no accumulation |
| Proximity radius | Per-challenge slider, shown as circle on map |
| Active challenge limit | 1 per team at a time (tracked on team row) |
| Team pin on admin map | At the challenge location when active |
| Claim mechanic | Honor system, confirmation dialog, first to complete wins |
| Multiple teams on same challenge | Yes — first to complete wins |
| Team locations visible to others | Never |
| Location storage | Every ping stored permanently in Postgres |
| Redis | Not needed |
| Map provider | Protomaps + MapLibre GL JS, self-hosted on Hetzner |
| Leaderboard | Always visible to all teams |
| Game duration field | Admin sets duration in minutes; start/end computed at game start |
| Challenge ordering | `sortOrder` — admin sets queue sequence via drag-to-reorder |
| Challenge expiration | Global per game — expires after X minutes, yanked from all teams |
| Active challenge count | K challenges on the map at once, set per game |
| Active challenge tracking | `activeChallengeId` on team row (no separate state table) |

---

## 10. Build DAG

1. [x] **Monorepo scaffold**
   1.1. [x] Root `package.json` with workspaces
   1.2. [x] `tsconfig.base.json` shared compiler options
   1.3. [x] `.gitignore`, `.env`
2. **Shared package** (`@t4al/shared`) — needs rework for queue model
   2.1. [ ] `types.ts` — update Game (add activeChallengeCount, challengeExpireMinutes; remove leaderboardMode), Challenge (sortOrder replaces spawnOffsetMinutes, new statuses, activatedAt), remove GameModeSegment
   2.2. [ ] `events.ts` — remove mode events, add challenge:expired/yanked, remove challenge:unlocked/left
   2.3. [ ] `constants.ts` — remove offset/mode constants
3. **Database** — needs migration for queue model
   3.1. [x] `pool.ts` — pg connection pool
   3.2. [x] `migrate.ts` — migration runner
   3.3. [x] `001_initial.sql` + `002_simplify.sql` — existing schema
   3.4. [ ] `003_challenge_queue.sql` — drop game_mode_segments table, drop leaderboard_mode from games, add active_challenge_count + challenge_expire_minutes to games, replace spawn_offset_minutes with sort_order on challenges, replace status enum (queued/active/claimed/expired), replace spawned_at with activated_at
4. **Server core** — needs rework for queue model
   4.1. [x] Express app + HTTP server setup
   4.2. [x] Socket.io attach to HTTP server
   4.3. [ ] Game routes — update create game (new fields), remove mode references
   4.4. [x] Team routes — create team, list teams
   4.5. [ ] Challenge routes — update CRUD (sortOrder instead of offset), remove mode endpoints
   4.6. [ ] Socket event handlers — remove mode/proximity events, add expired/yanked/activated/abandoned broadcasts, add game:state snapshot on join
   4.7. [ ] Background ticker — rewrite: queue-based expiration + fill (replaces offset spawning + mode transitions)
5. [x] **Client core**
   5.1. [x] Vite + React + TypeScript scaffold
   5.2. [x] MapLibre GL JS + PMTiles rendering (local chicago.pmtiles)
   5.3. [x] Custom dark map style
   5.4. [x] Socket.io client connection (autoConnect: false)
   5.5. [ ] Zustand store — update for new events (expired, yanked), remove mode state
6. [x] **Join flow** (end-to-end)
   6.1. [x] `/join` page — enter join code
   6.2. [x] Lobby UI — see teams, create team, join team
   6.3. [x] Server: join API + socket room management
   6.4. [ ] Admin starts game → all clients transition to map
7. **Challenge system** — needs rework for queue model
   7.1. [ ] Admin challenge creation UI — remove spawn offset, add to sortable list
   7.2. [ ] Challenge pins on team map — update for queue statuses, disappear on claim/expire
   7.3. [x] Proximity detection (GPS + haversine, client-side)
   7.4. [x] Activate flow (set active, reveal description)
   7.5. [x] Complete flow (confirm dialog, atomic claim, score update)
   7.6. [x] Abandon flow
   7.7. [ ] Challenge queue ticker (expiration + fill, done server-side)
   7.8. [ ] Sortable challenge order list (admin setup)
8. **Leaderboard** — simplify
   8.1. [ ] Leaderboard component — remove mode logic, always visible
9. **Admin dashboard** — needs rework
   9.1. [ ] Merge setup + live into tabbed page
   9.2. [ ] Setup tab: game settings (new fields), challenge creation, challenge order
   9.3. [ ] Live tab: admin map with team positions (remove blackout hiding)
   9.4. [ ] Live tab: challenge status list (new statuses)
   9.5. [x] Live tab: force end game
   9.6. [ ] Live tab: event log — update event types
10. [x] **End screen**
    10.1. [x] Final leaderboard with standings
11. [ ] **Deploy**
    11.1. [ ] Build scripts (server + client)
    11.2. [ ] nginx config (TLS, reverse proxy, PMTiles serving)
    11.3. [ ] pm2 or systemd for server process
    11.4. [ ] PMTiles file on VPS
