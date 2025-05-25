// server/routes/index.js
const express = require('express');
const router = express.Router();

// Placeholder dla dodatkowych tras API
// Wszystkie główne trasy są już zdefiniowane w server/index.js

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Stats endpoint
router.get('/stats', (req, res) => {
  const games = req.app.get('games');
  const activeRooms = req.app.get('activeRooms');
  
  res.json({
    totalRooms: activeRooms.size,
    activeGames: games.size,
    totalPlayers: Array.from(games.values()).reduce((sum, game) => sum + game.players.size, 0)
  });
});

module.exports = router;