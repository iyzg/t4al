import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import pool from './db/pool.js';
import gameRoutes from './routes/games.js';
import teamRoutes from './routes/teams.js';
import challengeRoutes from './routes/challenges.js';
import { registerSocketHandlers } from './socket.js';
import { startTicker } from './ticker.js';
import { asyncHandler } from './asyncHandler.js';

const app = express();
app.use(cors());
app.use(express.json());

// Wrap express in a raw HTTP server — Socket.io will attach to this
const httpServer = createServer(app);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/games', gameRoutes);
app.use('/api/games/:gameId/teams', teamRoutes);
app.use('/api/games/:gameId/challenges', challengeRoutes);
app.use('/api/challenges', challengeRoutes);

// Game events (for admin live panel)
app.get('/api/games/:gameId/events', asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM game_events WHERE game_id = $1 ORDER BY created_at DESC LIMIT 100',
    [req.params.gameId],
  );
  res.json(result.rows);
}));

// Error-handling middleware — must be after all routes
// Express identifies this as an error handler by the 4-arg signature
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // JSON body parse error (malformed JSON)
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid JSON' });
    return;
  }
  // Postgres: invalid UUID format
  if (err.code === '22P02') {
    res.status(400).json({ error: 'invalid id format' });
    return;
  }
  // Postgres: foreign key violation (e.g. team referencing nonexistent game)
  if (err.code === '23503') {
    res.status(400).json({ error: 'referenced resource does not exist' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

const io = new Server(httpServer, { cors: { origin: '*' } });
app.set('io', io);  // Make io accessible to routes via req.app.get('io')
registerSocketHandlers(io);
startTicker(io);

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
