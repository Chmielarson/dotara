// server/index.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const { Connection, PublicKey, clusterApiUrl } = require('@solana/web3.js');
const GameEngine = require('./game/GameEngine');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Konfiguracja Solana
const SOLANA_NETWORK = process.env.SOLANA_NETWORK || 'devnet';
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || clusterApiUrl(SOLANA_NETWORK);
const PROGRAM_ID = new PublicKey(process.env.SOLANA_PROGRAM_ID);

const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

// Przechowywanie stanów gier
const games = new Map();
const activeRooms = new Map();
const playerSockets = new Map(); // playerAddress -> socketId
const socketPlayers = new Map(); // socketId -> { playerAddress, roomId }

// API Routes
app.get('/api/rooms', (req, res) => {
  const rooms = Array.from(activeRooms.values())
    .filter(room => room.isActive && !room.winner)
    .map(room => ({
      id: room.id,
      creatorAddress: room.creatorAddress,
      maxPlayers: room.maxPlayers,
      entryFee: room.entryFee,
      currentPlayers: room.players.length,
      players: room.players,
      gameStarted: room.gameStarted,
      roomAddress: room.roomAddress,
      mapSize: room.mapSize,
      gameDuration: room.gameDuration
    }));
  
  res.json(rooms);
});

app.post('/api/rooms', async (req, res) => {
  try {
    const { 
      creatorAddress, 
      maxPlayers, 
      entryFee, 
      roomAddress, 
      mapSize,
      gameDuration
    } = req.body;
    
    const roomId = `room_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    const room = {
      id: roomId,
      creatorAddress,
      roomAddress,
      maxPlayers,
      entryFee,
      players: [creatorAddress],
      gameStarted: false,
      winner: null,
      createdAt: new Date().toISOString(),
      isActive: true,
      mapSize: mapSize || 3000,
      gameDuration: gameDuration || 10,
      blockchainEnded: false
    };
    
    activeRooms.set(roomId, room);
    
    // Emit to all clients
    io.emit('rooms_update', Array.from(activeRooms.values()));
    
    res.status(201).json({ roomId, ...room });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

app.post('/api/rooms/:id/join', async (req, res) => {
  try {
    const roomId = req.params.id;
    const { playerAddress } = req.body;
    
    const room = activeRooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    if (room.gameStarted) {
      return res.status(400).json({ error: 'Game already started' });
    }
    
    if (room.players.length >= room.maxPlayers) {
      return res.status(400).json({ error: 'Room is full' });
    }
    
    if (!room.players.includes(playerAddress)) {
      room.players.push(playerAddress);
    }
    
    activeRooms.set(roomId, room);
    io.emit('rooms_update', Array.from(activeRooms.values()));
    
    res.json({ success: true, room });
  } catch (error) {
    console.error('Error joining room:', error);
    res.status(500).json({ error: 'Failed to join room' });
  }
});

app.post('/api/rooms/:id/start', async (req, res) => {
  try {
    const roomId = req.params.id;
    const { gameId, initiatorAddress } = req.body;
    
    const room = activeRooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    if (room.gameStarted) {
      return res.status(400).json({ error: 'Game already started' });
    }
    
    if (!room.players.includes(initiatorAddress)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    if (room.players.length < 2) {
      return res.status(400).json({ error: 'Not enough players' });
    }
    
    // Rozpocznij grę
    room.gameStarted = true;
    room.gameId = gameId;
    room.gameStartedAt = new Date().toISOString();
    
    // Utwórz instancję gry
    const game = new GameEngine(roomId, room.mapSize);
    
    // Dodaj wszystkich graczy
    for (const playerAddress of room.players) {
      game.addPlayer(playerAddress);
    }
    
    // Rozpocznij grę
    game.start();
    games.set(roomId, game);
    
    activeRooms.set(roomId, room);
    io.emit('rooms_update', Array.from(activeRooms.values()));
    
    // Powiadom graczy w pokoju
    io.to(roomId).emit('game_started', { roomId, gameId });
    
    // Ustaw timer zakończenia gry
    setTimeout(() => {
      endGameByTimeout(roomId);
    }, room.gameDuration * 60 * 1000);
    
    res.json({ success: true, gameId });
  } catch (error) {
    console.error('Error starting game:', error);
    res.status(500).json({ error: 'Failed to start game' });
  }
});

app.post('/api/rooms/:id/eliminate', async (req, res) => {
  try {
    const roomId = req.params.id;
    const { playerAddress } = req.body;
    
    const game = games.get(roomId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    game.removePlayer(playerAddress);
    
    // Jeśli został tylko jeden gracz, zakończ grę
    if (game.winner) {
      const room = activeRooms.get(roomId);
      room.winner = game.winner;
      room.isActive = false;
      room.endedAt = new Date().toISOString();
      
      activeRooms.set(roomId, room);
      io.to(roomId).emit('game_ended', { winner: game.winner });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error eliminating player:', error);
    res.status(500).json({ error: 'Failed to eliminate player' });
  }
});

app.post('/api/rooms/:id/end', async (req, res) => {
  try {
    const roomId = req.params.id;
    const { winnerAddress } = req.body;
    
    const room = activeRooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    room.winner = winnerAddress;
    room.isActive = false;
    room.blockchainEnded = true;
    room.endedAt = new Date().toISOString();
    
    const game = games.get(roomId);
    if (game) {
      game.stop();
      games.delete(roomId);
    }
    
    activeRooms.set(roomId, room);
    io.emit('rooms_update', Array.from(activeRooms.values()));
    io.to(roomId).emit('game_ended', { winner: winnerAddress, blockchainConfirmed: true });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error ending game:', error);
    res.status(500).json({ error: 'Failed to end game' });
  }
});

// Socket.IO handlers
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  socket.on('join_game', ({ roomId, playerAddress }) => {
    const game = games.get(roomId);
    if (!game) {
      socket.emit('error', { message: 'Game not found' });
      return;
    }
    
    // Zapisz mapowanie
    playerSockets.set(playerAddress, socket.id);
    socketPlayers.set(socket.id, { playerAddress, roomId });
    
    // Dołącz do pokoju
    socket.join(roomId);
    
    // Dodaj gracza do gry jeśli go nie ma
    game.addPlayer(playerAddress);
    
    console.log(`Player ${playerAddress} joined game ${roomId}`);
  });
  
  socket.on('player_input', (data) => {
    const { roomId, playerAddress, input } = data;
    
    const game = games.get(roomId);
    if (!game) return;
    
    game.updatePlayer(playerAddress, input);
  });
  
  socket.on('set_nickname', ({ roomId, playerAddress, nickname }) => {
    const game = games.get(roomId);
    if (!game) return;
    
    const player = game.players.get(playerAddress);
    if (player) {
      player.nickname = nickname;
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    const playerInfo = socketPlayers.get(socket.id);
    if (playerInfo) {
      const { playerAddress, roomId } = playerInfo;
      
      // Usuń mapowania
      playerSockets.delete(playerAddress);
      socketPlayers.delete(socket.id);
      
      // Oznacz gracza jako nieaktywnego (nie usuwaj go całkowicie)
      const game = games.get(roomId);
      if (game) {
        const player = game.players.get(playerAddress);
        if (player) {
          player.isConnected = false;
        }
      }
    }
  });
});

// Funkcja broadcastująca stan gry
function broadcastGameState() {
  for (const [roomId, game] of games) {
    if (!game.isRunning) continue;
    
    const gameState = game.getGameState();
    
    // Wyślij stan gry do wszystkich w pokoju
    io.to(roomId).emit('game_state', gameState);
    
    // Wyślij widok każdego gracza
    for (const [playerAddress, player] of game.players) {
      const socketId = playerSockets.get(playerAddress);
      if (socketId && player.isAlive) {
        const playerView = game.getPlayerView(playerAddress);
        io.to(socketId).emit('player_view', playerView);
      }
    }
  }
}

// Broadcast co 50ms (20 FPS dla klientów)
setInterval(broadcastGameState, 50);

// Funkcja kończąca grę po czasie
async function endGameByTimeout(roomId) {
  const game = games.get(roomId);
  const room = activeRooms.get(roomId);
  
  if (!game || !room || !game.isRunning) return;
  
  // Znajdź gracza z największą masą
  let winner = null;
  let maxMass = 0;
  
  for (const [address, player] of game.players) {
    if (player.isAlive && player.mass > maxMass) {
      maxMass = player.mass;
      winner = address;
    }
  }
  
  if (winner) {
    game.winner = winner;
    game.stop();
    
    room.winner = winner;
    room.isActive = false;
    room.endedAt = new Date().toISOString();
    
    activeRooms.set(roomId, room);
    io.to(roomId).emit('game_ended', { 
      winner, 
      reason: 'timeout',
      finalLeaderboard: game.leaderboard 
    });
    
    console.log(`Game ${roomId} ended by timeout. Winner: ${winner}`);
  }
}

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Solana.io server running on port ${PORT}`);
  console.log(`Connected to Solana ${SOLANA_NETWORK}`);
  console.log(`Program ID: ${PROGRAM_ID.toString()}`);
});