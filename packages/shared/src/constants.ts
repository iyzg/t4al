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

// Team palette (7 fixed colors). The server validates the submitted color
// against this list on team create.
export const TEAM_COLORS: readonly string[] = [
  '#C41230', // red
  '#0082C8', // blue
  '#80561B', // brown
  '#008751', // green
  '#492F90', // purple
  '#F38AB4', // pink
  '#FBD907', // yellow
] as const;

// Single color used for all challenge pins and challenge-typed surfaces.
// Challenge TYPE (normal / variable / wager) is differentiated by icon or
// text, not by color.
export const CHALLENGE_COLOR = '#F48027';

// Auth code shapes
export const JOIN_CODE_LENGTH  = 4;   // uppercase alphanumeric
export const ADMIN_CODE_BYTES  = 12;  // 16-char base64url when encoded
