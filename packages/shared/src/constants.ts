// Timing
export const LOCATION_PING_INTERVAL_MS   = 5_000;   // each device pings GPS every 5s
export const ADMIN_POSITION_INTERVAL_MS  = 5_000;   // server broadcasts team positions to admin every 5s
export const DEVICE_PING_STALE_MS        = 30_000;  // pings older than this are ignored when averaging

// Proximity
export const DEFAULT_PROXIMITY_METERS    = 100;
export const MIN_PROXIMITY_METERS        = 50;
export const MAX_PROXIMITY_METERS        = 300;

// Game defaults (admin can override at creation)
export const DEFAULT_ACTIVE_CHALLENGE_COUNT  = 3;
export const DEFAULT_CHALLENGE_EXPIRE_MINUTES = 10;
export const DEFAULT_STARTING_TOKENS         = 50;

// Team palette (7 fixed colors — client-side palette must match)
export const TEAM_COLORS: readonly string[] = [
  '#e74c3c',
  '#3498db',
  '#2ecc71',
  '#f39c12',
  '#9b59b6',
  '#1abc9c',
  '#e67e22',
] as const;

// Auth code shapes
export const JOIN_CODE_LENGTH  = 4;   // uppercase alphanumeric
export const ADMIN_CODE_BYTES  = 12;  // 16-char base64url when encoded
