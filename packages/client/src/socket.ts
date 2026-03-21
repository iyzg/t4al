import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@t4al/shared';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Single shared socket instance.
// Vite proxies /socket.io to the server (see vite.config.ts),
// so we connect to the same origin — no explicit URL needed.
export const socket: AppSocket = io({ autoConnect: false });
