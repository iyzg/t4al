import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@t4al/shared';
import gameRoutes from './routes/games.js';
import teamRoutes from './routes/teams.js';
import challengeRoutes from './routes/challenges.js';
import { registerSocketHandlers } from './socket.js';
import { recoverActiveGames } from './lifecycle.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));

// Raw HTTP server so Socket.io can attach
const httpServer = createServer(app);

app.get('/api/health', (_req, res) => { res.json({ status: 'ok' }); });

app.use('/api/games', gameRoutes);
app.use('/api/games/:gameId/teams', teamRoutes);
app.use('/api/games/:gameId/challenges', challengeRoutes);
app.use('/api/challenges', challengeRoutes);

// Error middleware (4-arg signature identifies it as an error handler)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid JSON' });
    return;
  }
  if (err.code === '22P02') {                  // Postgres: invalid UUID
    res.status(400).json({ error: 'invalid id format' });
    return;
  }
  if (err.code === '23503') {                  // Postgres: FK violation
    res.status(400).json({ error: 'referenced resource does not exist' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*' },
});
app.set('io', io);
registerSocketHandlers(io);

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, async () => {
  console.log(`Server listening on :${PORT}`);
  try {
    await recoverActiveGames(io);
  } catch (err) {
    console.error('Recovery failed:', err);
  }
});
