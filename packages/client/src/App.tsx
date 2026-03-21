import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import JoinPage from './pages/JoinPage';
import GamePage from './pages/GamePage';
import AdminSetupPage from './pages/AdminSetupPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/join" element={<JoinPage />} />
        <Route path="/game/:gameId" element={<GamePage />} />
        <Route path="/game/:gameId/admin/setup" element={<AdminSetupPage />} />
        <Route path="*" element={<Navigate to="/join" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
