# In the Loop — Game Website Specs
*A real-time city scavenger hunt set in Chicago's Loop*

---

## 1. Overview

**Concept**: Teams compete across Chicago's Loop in a live, map-based challenge game. An admin pre-configures all challenges before the game: placing pins on a map, writing names and descriptions, assigning fixed point values, and scheduling spawn offsets. Teams travel to challenge locations, activate them on arrival, complete them on the honor system, and the first team to mark complete wins the points.

**Confirmed Decisions**
- 5–7 teams, 1 device per team
- All challenges created by admin during setup — no templates
- Each challenge has a fixed point value set at creation (no accumulation)
- Teams see a challenge pin but not the description until they set it active
- Teams can only activate a challenge when within the admin-set proximity radius
- Only 1 active challenge per team at a time (tracked via `activeChallengeId` on team)
- When a team activates a challenge, their pin appears at that challenge on the admin map
- First team to mark complete wins the points (honor system + confirmation dialog)
- Team locations never shown to other teams
- All location pings stored permanently in Postgres for post-game stats
- Game has a **mode timeline** — admin paints colored segments (like a video editor) to define when different game modes are active. Modes are game-wide behavioral modifiers (not just leaderboard toggles). Blackout is the first mode; architecture supports adding more later.
- All timing is **relative** — challenge spawns and mode segments are defined as offsets from game start. No absolute datetimes during setup.

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
  startTime: Date | null;               // set when admin starts the game
  endTime: Date | null;                 // computed: startTime + durationMinutes
  joinCode: string;
  adminCode: string;                    // secret code to access admin pages
  leaderboardMode: 'full' | 'rank_only' | 'hidden';  // current live state
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

  // Spawn timing (always relative)
  spawnOffsetMinutes: number;    // minutes after game start

  // Runtime
  status: 'scheduled' | 'active' | 'claimed';
  spawnedAt: Date | null;
  claimedByTeamId: string | null;
  claimedAt: Date | null;
}
```

### `GameModeSegment`
```ts
// A painted segment on the mode timeline (offsets from game start)
interface GameModeSegment {
  id: string;
  gameId: string;
  mode: 'blackout';                    // extendable: add more modes later
  startOffsetMinutes: number;          // minutes after game start
  endOffsetMinutes: number;            // minutes after game start
}
```

**Mode behavior:**

Modes are game-wide behavioral modifiers that can affect multiple aspects of gameplay simultaneously.

| Mode | Effect on teams | Effect on admin map |
|---|---|---|
| `blackout` | Leaderboard fully hidden | All team pins hidden |

*Future modes slot in here with their own row — e.g., a mode that hides challenge pins, or one that doubles points.*

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

### 4.1 Challenge Spawning

All challenges have a `spawnOffsetMinutes` — minutes after game start. A background ticker checks every 10 seconds. When `now >= game.startTime + challenge.spawnOffsetMinutes`, the challenge status flips to `'active'` and a pin appears on all team maps.

### 4.2 Challenge Flow: Visible → Unlocked → Active → Complete

**Visible** — spawned, team not in range. Name + points shown, description hidden.

**Unlocked** — team enters proximity radius. "Set as Active?" prompt shown. Team must have no current active challenge.

**Active** — team taps "Set as Active." Description revealed. `team.activeChallengeId` set to this challenge. Team pin moves to challenge location on admin map. Team locked from activating another.

**Complete** — team taps "Mark as Complete." Confirmation dialog: *"Are you sure you completed this challenge?"* First to confirm wins the points. All clients get leaderboard update.

### 4.3 Abandoning a Challenge
Team can drop active challenge at any time, no penalty. `activeChallengeId` set to null. Frees them to activate another.

### 4.4 Mode Timeline Runtime

A background ticker checks against `GameModeSegment` rows to determine the current active mode. Segment times are computed at runtime: `game.startTime + startOffsetMinutes`. When a segment boundary is crossed:
- Server updates `game.leaderboardMode`
- Broadcasts `mode:change` event to all connected clients
- All mode-specific effects applied (leaderboard visibility, admin map pins, etc.)

If no segment is active at a given moment, the game runs in default mode (`full` leaderboard, all team pins visible on admin map).

Multiple segments can exist but **should not overlap** — validated at setup time.

### 4.5 Location Tracking
```ts
// In-memory, overwritten each ping. Used for proximity checks only.
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
2. Play zone overlay — game boundary polygon
3. Challenge markers — pins per spawned challenge
4. My position — your team's GPS dot
5. Proximity ring — activation radius circle (shown when tapping a pin)
6. Claim burst animation — fires on any challenge completion

### 5.3 Challenge Marker States
| State | Visual |
|---|---|
| Spawned, not in range | Pulsing pin, name + points label |
| In range | Highlighted ring, "Set as Active?" prompt |
| Your team active | Pin outlined in your team color |
| Claimed by your team | Checkmark pin, your team color |
| Claimed by other team | Greyed out, shows team name |

### 5.4 HUD
- **Top bar**: Game name, countdown to end
- **Leaderboard panel**: Reflects current mode
  - `full`: name, color, score, rank
  - `rank_only`: name, color, rank only
  - `hidden`: not shown at all
- **Mode banner**: shown when a special mode is active (e.g. "BLACKOUT" during blackout)
- **Challenge card** (on tap): name, points, description if active, CTAs

### 5.5 Views
- `/join` — Enter join code, land in lobby (see teams, create your own, then join)
- `/game/:gameId` — Main map
- `/game/:gameId/admin/setup` — Pre-game setup (requires admin code)
- `/game/:gameId/admin` — Admin live view (requires admin code)
- `/game/:gameId/end` — Final leaderboard + stats

---

## 6. Admin: Setup Page (`/admin/setup`)

### Game Settings Panel
- Game name
- Duration (minutes)
- Join code (auto-generated, editable)
- Admin code (secret code to access admin pages)
- Default leaderboard mode (when no segment is active)

### Challenge Creation (Map-First)
Full-screen map of Chicago. Admin creates challenges directly:

1. **Click anywhere on the map** → challenge creation popover opens
2. Fill in:
   - **Name** — visible to teams before activation
   - **Description** — revealed only on activation
   - **Points** — fixed integer
   - **Activation radius** — slider (50–300m); shown as a live circle on the map
   - **Spawn time** — relative offset: "+X min after start"
3. Save → pin drops, stays editable (click to reopen)
4. Drag pin to reposition

### Game Timeline

A horizontal editor spanning 0 → duration, with **two tracks**:

**Track 1 — Challenge spawns** (top, read-only in this view)
- Each challenge shown as a labeled tick at its spawn offset
- Click a tick to jump to that challenge's edit popover on the map

**Track 2 — Mode segments** (bottom, paintable)
- **Drag on empty space** to paint a new segment
- Segments are color-coded by mode (blackout = dark red/black)
- **Drag edges** to resize a segment
- **Drag the body** to move it
- **Click a segment** to see its mode label and a delete button
- Segments cannot overlap — if you try, it snaps to the nearest gap
- Empty stretches of the track = default mode (full leaderboard)

This gives the admin a complete visual overview of the game's pacing and information flow before launch.

---

## 7. Admin: Live Panel (`/admin`)

### Map
- All team GPS positions, labeled by name + color
- Active challenge teams → pin at challenge location
- During blackout segment: all team pins hidden

### Challenge List
- All challenges: status, claimer, claim time

### Controls
- Manually spawn a challenge early
- Manually trigger a mode change (override the timeline)
- Toggle leaderboard mode directly
- Force end game

### Live Event Log
Timestamped feed: challenge spawned, team X activated Y, team X completed Y for Z pts, mode changed to blackout, etc.

---

## 8. Real-Time (WebSockets)

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
'leaderboard:update'     { teams: { id, name, color, score, rank }[], mode }
'mode:change'            { mode, segmentId? }
'game:ended'             { finalScores }
```

### Server → Team (private)
```ts
'challenge:unlocked'     { challengeId }
'challenge:left'         { challengeId }
'complete:success'       { challengeId, points }
'complete:failed'        { reason: 'already_claimed' | 'not_active' }
```

---

## 9. Post-Game Stats

Built from `LocationHistory` + challenge events:
- Final leaderboard with full scores
- Total distance walked per team
- Heatmap of where each team spent time
- Challenge timeline: who got what, when, for how many points
- "Near misses" — two teams at the same challenge within 60 seconds of each other
- Game replay animation — each team's trail over time
- Cross-game stats across all In the Loop events

---

## 10. MVP vs. Phase 2

### MVP
- [ ] Join flow with team selection
- [ ] Admin setup: game config, map-based challenge creation
- [ ] Game timeline: challenge spawn ticks + paintable mode track
- [ ] Protomaps + MapLibre GL JS, self-hosted on Hetzner
- [ ] Challenge pin visibility, proximity unlock, activate flow (1 active per team)
- [ ] Fixed points, honor system complete with confirmation
- [ ] Auto-spawning at relative offsets
- [ ] Mode segment runtime (background ticker + WebSocket broadcast)
- [ ] Blackout mode (leaderboard hidden + team pins hidden)
- [ ] Admin live map + event log + manual overrides
- [ ] Location history to Postgres
- [ ] Game end screen + basic stats

### Phase 2
- [ ] Additional mode types (challenges hidden, double points, etc.)
- [ ] Drag-to-resize segments with snapping polish
- [ ] Full replay animation
- [ ] Heatmaps + advanced stats
- [ ] Push notifications for nearby challenges
- [ ] Mobile-native wrapper (Capacitor)
- [ ] Cross-game stats dashboard

---

## 11. Resolved Decisions

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
| Leaderboard default | Admin-set; full / rank_only / hidden |
| Mode timeline | Video-editor-style: drag to paint segments on a track |
| Blackout mode | One segment type; affects leaderboard + admin map pins |
| Game modes | Game-wide behavioral modifiers, not just leaderboard toggles |
| Future modes | Architecture supports adding more segment types |
| Game duration field | Admin sets duration in minutes; start/end computed at game start |
| Spawn timing | Relative only — offset in minutes from game start |
| Challenge expiration | No expiration; challenges stay active until claimed or game ends |
| Active challenge tracking | `activeChallengeId` on team row (no separate state table) |

---

## 12. Build DAG

1. [x] **Monorepo scaffold**
   1.1. [x] Root `package.json` with workspaces
   1.2. [x] `tsconfig.base.json` shared compiler options
   1.3. [x] `.gitignore`, `.env`
2. [x] **Shared package** (`@t4al/shared`)
   2.1. [x] `types.ts` — all data model interfaces
   2.2. [x] `events.ts` — Socket.io event type definitions
   2.3. [x] `constants.ts` — timing intervals, proximity bounds
   2.4. [x] `index.ts` — barrel re-export
   2.5. [x] Build with `tsc`, verify output
3. [x] **Database**
   3.1. [x] `pool.ts` — pg connection pool
   3.2. [x] `migrate.ts` — migration runner
   3.3. [x] `001_initial.sql` — schema (games, teams, challenges, segments, location_history, game_events)
   3.4. [x] `002_simplify.sql` — apply spec changes (drop team_challenge_states, add active_challenge_id to teams, simplify challenges/segments)
4. [ ] **Server core**
   4.1. [x] Express app + HTTP server setup
   4.2. [x] Socket.io attach to HTTP server
   4.3. [x] Game routes — create game, get game, start game, end game
   4.4. [x] Team routes — create team, list teams
   4.5. [ ] Challenge routes — CRUD, claim
   4.6. [ ] Socket event handlers — location, challenge actions, join
   4.7. [ ] Background ticker — challenge spawning, mode transitions
5. [ ] **Client core**
   5.1. [ ] Vite + React + TypeScript scaffold
   5.2. [ ] MapLibre GL JS + PMTiles rendering
   5.3. [ ] Custom map style
   5.4. [ ] Socket.io client connection
   5.5. [ ] Zustand store setup
6. [ ] **Join flow** (end-to-end)
   6.1. [ ] `/join` page — enter join code
   6.2. [ ] Lobby UI — see teams, create team, join team
   6.3. [ ] Server: join API + socket room management
   6.4. [ ] Admin starts game → all clients transition to map
7. [ ] **Challenge system**
   7.1. [ ] Admin challenge creation UI (click map → popover)
   7.2. [ ] Challenge pins on team map
   7.3. [ ] Proximity detection (GPS + radius check)
   7.4. [ ] Activate flow (set active, reveal description)
   7.5. [ ] Complete flow (confirm, atomic claim, score update)
   7.6. [ ] Abandon flow
   7.7. [ ] Auto-spawn ticker (offset-based)
8. [ ] **Leaderboard + modes**
   8.1. [ ] Leaderboard component (full / rank_only / hidden)
   8.2. [ ] Mode segment runtime (ticker checks segments)
   8.3. [ ] Mode effects system (extensible per-mode behavior)
   8.4. [ ] Admin timeline editor (paintable segments)
9. [ ] **Admin live panel**
   9.1. [ ] Admin map with team positions
   9.2. [ ] Challenge status list
   9.3. [ ] Manual controls (spawn early, force mode, end game)
   9.4. [ ] Live event log
10. [ ] **End screen + stats**
    10.1. [ ] Final leaderboard
    10.2. [ ] Basic stats (distance, challenge timeline)
    10.3. [ ] Game event replay
11. [ ] **Deploy**
    11.1. [ ] Build scripts (server + client)
    11.2. [ ] nginx config (TLS, reverse proxy, PMTiles serving)
    11.3. [ ] pm2 or systemd for server process
    11.4. [ ] PMTiles file on VPS
