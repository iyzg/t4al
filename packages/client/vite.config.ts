import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only: serve tools/dev/dev-snippet.js at /dev-snippet.js so the local
// console-paste workflow keeps working without shipping the file to prod.
// configureServer only runs under `vite dev`, never during `vite build`.
function devSnippetPlugin() {
  const file = path.resolve(__dirname, '../../tools/dev/dev-snippet.js');
  return {
    name: 't4al-dev-snippet',
    apply: 'serve' as const,
    configureServer(server: any) {
      server.middlewares.use('/dev-snippet.js', (_req: any, res: any) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(fs.readFileSync(file, 'utf-8'));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devSnippetPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
});
