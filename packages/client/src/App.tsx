import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import JoinPage from './pages/JoinPage';
import GamePage from './pages/GamePage';
import AdminSetupPage from './pages/AdminSetupPage';
import AdminLivePage from './pages/AdminLivePage';
import AdminEntryPage from './pages/AdminEntryPage';
import CreateGamePage from './pages/CreateGamePage';
import EndPage from './pages/EndPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CreateGamePage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/admin" element={<AdminEntryPage />} />
        <Route path="/game/:gameId" element={<GamePage />} />
        <Route path="/game/:gameId/admin/setup" element={<AdminSetupPage />} />
        <Route path="/game/:gameId/admin" element={<AdminLivePage />} />
        <Route path="/game/:gameId/end" element={<EndPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
