import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import gameRoutes from './routes/games.js';
import teamRoutes from './routes/teams.js';

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

const io = new Server(httpServer, { cors: { origin: '*' } })
io.on('connection', (socket) => { console.log('client connected:', socket.id); })

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
