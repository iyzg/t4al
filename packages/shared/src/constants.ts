export const HEARTBEAT_INTERVAL_MS = 30_000;     // how often teams send GPS pings
export const TICKER_INTERVAL_MS = 10_000;         // how often server checks queue + game expiration
export const LOCATION_FLUSH_INTERVAL_MS = 5_000;  // how often batched location pings write to DB
export const DEFAULT_PROXIMITY_METERS = 100;
export const MIN_PROXIMITY_METERS = 50;
export const MAX_PROXIMITY_METERS = 300;
export const DEFAULT_ACTIVE_CHALLENGE_COUNT = 3;
export const DEFAULT_CHALLENGE_EXPIRE_MINUTES = 10;
