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

// Dodaj middleware do logowania
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  // Dodaj opcje dla lepszej kompatybilności
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// Konfiguracja Solana
const SOLANA_NETWORK = process.env.SOLANA_NETWORK || 'devnet';
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || clusterApiUrl(SOLANA_NETWORK);
const PROGRAM_ID = new PublicKey(process.env.SOLANA_PROGRAM_ID || 'EhP1ossEJvx2hrRWhbsQDUVoUoFbWGjap3uxZsjMaknH');

const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

// Przechowywanie stanów gier
const games = new Map();
const activeRooms = new Map();
const playerSockets = new Map(); // playerAddress -> socketId
const socketPlayers = new Map(); // socketId -> { playerAddress, roomId }
const endedGames = new Set(); // Set do śledzenia zakończonych gier

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

// Endpoint dla pojedynczego pokoju
app.get('/api/rooms/:id', (req, res) => {
  const roomId = req.params.id;
  const room = activeRooms.get(roomId);
  
  console.log(`GET /api/rooms/${roomId} - ${room ? 'found' : 'not found'}`);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  res.json({
    id: room.id,
    creatorAddress: room.creatorAddress,
    maxPlayers: room.maxPlayers,
    entryFee: room.entryFee,
    currentPlayers: room.players.length,
    players: room.players,
    gameStarted: room.gameStarted,
    roomAddress: room.roomAddress,
    mapSize: room.mapSize,
    gameDuration: room.gameDuration,
    winner: room.winner,
    isActive: room.isActive,
    gameStartedAt: room.gameStartedAt
  });
});

app.post('/api/rooms', async (req, res) => {
  try {
    const { 
      creatorAddress, 
      maxPlayers, 
      entryFee, 
      roomAddress, 
      mapSize,
      gameDuration,
      transactionSignature
    } = req.body;
    
    console.log('Creating room:', {
      creatorAddress,
      maxPlayers,
      entryFee,
      roomAddress,
      mapSize,
      gameDuration
    });
    
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
      blockchainEnded: false,
      transactionSignature
    };
    
    activeRooms.set(roomId, room);
    
    // Emit to all clients
    io.emit('rooms_update', Array.from(activeRooms.values()));
    
    console.log(`Room created successfully: ${roomId}`);
    res.status(201).json({ roomId, ...room });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({ error: 'Failed to create room', details: error.message });
  }
});

app.post('/api/rooms/:id/join', async (req, res) => {
  try {
    const roomId = req.params.id;
    const { playerAddress, transactionSignature } = req.body;
    
    console.log(`Player ${playerAddress} joining room ${roomId}`);
    
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
      console.log(`Player ${playerAddress} added to room ${roomId}`);
    } else {
      console.log(`Player ${playerAddress} already in room ${roomId}`);
    }
    
    activeRooms.set(roomId, room);
    io.emit('rooms_update', Array.from(activeRooms.values()));
    
    res.json({ success: true, room });
  } catch (error) {
    console.error('Error joining room:', error);
    res.status(500).json({ error: 'Failed to join room', details: error.message });
  }
});

app.post('/api/rooms/:id/start', async (req, res) => {
  try {
    const roomId = req.params.id;
    const { gameId, initiatorAddress, transactionSignature } = req.body;
    
    console.log(`Starting game ${roomId} by ${initiatorAddress}`);
    
    const room = activeRooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    if (room.gameStarted) {
      return res.status(400).json({ error: 'Game already started' });
    }
    
    if (!room.players.includes(initiatorAddress)) {
      return res.status(403).json({ error: 'Not authorized - not a player in this room' });
    }
    
    if (room.players.length < 2) {
      return res.status(400).json({ error: 'Not enough players' });
    }
    
    // Rozpocznij grę
    room.gameStarted = true;
    room.gameId = gameId;
    room.gameStartedAt = new Date().toISOString();
    room.transactionSignature = transactionSignature;
    
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
    
    console.log(`Game ${roomId} started successfully`);
    res.json({ success: true, gameId });
  } catch (error) {
    console.error('Error starting game:', error);
    res.status(500).json({ error: 'Failed to start game', details: error.message });
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
    const { winnerAddress, transactionSignature } = req.body;
    
    console.log(`Ending game ${roomId}, winner: ${winnerAddress}`);
    
    const room = activeRooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    // Sprawdź czy gra już została zakończona
    if (room.blockchainEnded) {
      console.log(`Game ${roomId} already ended on blockchain`);
      return res.json({ success: true, alreadyEnded: true });
    }
    
    room.winner = winnerAddress;
    room.isActive = false;
    room.blockchainEnded = true;
    room.endedAt = new Date().toISOString();
    room.endTransactionSignature = transactionSignature;
    
    const game = games.get(roomId);
    if (game) {
      game.stop();
      games.delete(roomId);
    }
    
    activeRooms.set(roomId, room);
    io.emit('rooms_update', Array.from(activeRooms.values()));
    
    // Wyślij potwierdzenie że gra została zakończona na blockchainie
    io.to(roomId).emit('game_ended', { 
      winner: winnerAddress, 
      blockchainConfirmed: true,
      transactionSignature 
    });
    
    console.log(`Game ${roomId} ended successfully`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error ending game:', error);
    res.status(500).json({ error: 'Failed to end game' });
  }
});

// Endpoint do czyszczenia nieaktywnych pokoi
app.post('/api/rooms/cleanup', async (req, res) => {
  try {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000); // 1 godzina
    let cleaned = 0;
    
    for (const [roomId, room] of activeRooms) {
      const roomAge = now - new Date(room.createdAt).getTime();
      
      // Usuń pokoje które:
      // - Zostały utworzone ponad godzinę temu i nie rozpoczęły się
      // - Lub mają zwycięzcę (gra się zakończyła)
      if ((roomAge > oneHourAgo && !room.gameStarted) || room.winner) {
        activeRooms.delete(roomId);
        
        // Usuń też grę jeśli istnieje
        const game = games.get(roomId);
        if (game) {
          game.stop();
          games.delete(roomId);
        }
        
        cleaned++;
      }
    }
    
    console.log(`Cleaned ${cleaned} inactive rooms`);
    res.json({ cleaned, activeRooms: activeRooms.size });
  } catch (error) {
    console.error('Error cleaning rooms:', error);
    res.status(500).json({ error: 'Failed to clean rooms' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    activeRooms: activeRooms.size,
    activeGames: games.size
  });
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
      console.log(`Player ${playerAddress} set nickname to: ${nickname}`);
    }
  });
  
  socket.on('get_rooms', () => {
    const rooms = Array.from(activeRooms.values())
      .filter(room => room.isActive && !room.winner);
    socket.emit('rooms_update', rooms);
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
    const gameState = game.getGameState();
    
    // Wyślij stan gry do wszystkich w pokoju
    io.to(roomId).emit('game_state', gameState);
    
    // Sprawdź czy gra się zakończyła
    if (game.winner && game.isRunning === false && !endedGames.has(roomId)) {
      const room = activeRooms.get(roomId);
      if (room && !room.winner) {
        room.winner = game.winner;
        room.isActive = false;
        room.endedAt = new Date().toISOString();
        
        activeRooms.set(roomId, room);
        endedGames.add(roomId); // Oznacz grę jako zakończoną
        
        // Wyślij event tylko raz
        io.to(roomId).emit('game_ended', { 
          winner: game.winner,
          reason: 'last_player_standing',
          finalLeaderboard: game.leaderboard,
          blockchainConfirmed: false
        });
        
        console.log(`Game ${roomId} ended. Winner: ${game.winner}`);
        
        // Usuń grę z mapy po wysłaniu informacji o zakończeniu
        setTimeout(() => {
          games.delete(roomId);
          // Usuń z endedGames po pewnym czasie
          setTimeout(() => {
            endedGames.delete(roomId);
          }, 60000); // 1 minuta
        }, 1000);
      }
    }
    
    // Wyślij widok każdego gracza
    for (const [playerAddress, player] of game.players) {
      const socketId = playerSockets.get(playerAddress);
      
      if (socketId) {
        if (!player.isAlive && game.isRunning) {
          // Wyślij informację o śmierci gracza tylko gdy gra trwa
          io.to(socketId).emit('player_eliminated', {
            playerAddress,
            eliminatedBy: 'another_player'
          });
        } else if (player.isAlive) {
          // Wyślij normalny widok dla żywego gracza
          const playerView = game.getPlayerView(playerAddress);
          io.to(socketId).emit('player_view', playerView);
        }
      }
    }
  }
}

// Broadcast co 50ms (20 FPS dla klientów)
setInterval(broadcastGameState, 16);

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

// Automatyczne czyszczenie nieaktywnych pokoi co 30 minut
setInterval(() => {
  const now = Date.now();
  const thirtyMinutesAgo = now - (30 * 60 * 1000);
  let cleaned = 0;
  
  for (const [roomId, room] of activeRooms) {
    const roomAge = now - new Date(room.createdAt).getTime();
    
    // Usuń pokoje które są stare i nieaktywne
    if ((roomAge > thirtyMinutesAgo && !room.gameStarted) || room.winner) {
      activeRooms.delete(roomId);
      
      const game = games.get(roomId);
      if (game) {
        game.stop();
        games.delete(roomId);
      }
      
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`Auto-cleaned ${cleaned} inactive rooms`);
  }
}, 30 * 60 * 1000); // 30 minut

// Dodaj ten endpoint do server/index.js (po innych endpointach API)

app.post('/api/rooms/:id/cancel', async (req, res) => {
  try {
    const roomId = req.params.id;
    const { transactionSignature } = req.body;
    
    console.log(`Cancelling room ${roomId}`);
    
    const room = activeRooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    if (room.gameStarted) {
      return res.status(400).json({ error: 'Cannot cancel - game already started' });
    }
    
    // Oznacz pokój jako anulowany
    room.isActive = false;
    room.cancelled = true;
    room.cancelledAt = new Date().toISOString();
    room.cancelTransactionSignature = transactionSignature;
    
    // Usuń grę jeśli istnieje
    const game = games.get(roomId);
    if (game) {
      game.stop();
      games.delete(roomId);
    }
    
    // Usuń pokój z aktywnych
    activeRooms.delete(roomId);
    
    // Powiadom wszystkich o aktualizacji
    io.emit('rooms_update', Array.from(activeRooms.values()));
    
    // Powiadom graczy w pokoju
    io.to(roomId).emit('room_cancelled', { roomId });
    
    console.log(`Room ${roomId} cancelled successfully`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error cancelling room:', error);
    res.status(500).json({ error: 'Failed to cancel room' });
  }
});

// Dodaj tę funkcję do server/index.js

// Funkcja do sprawdzania i czyszczenia starych pokoi na blockchainie
async function cleanupOldRoomsOnChain() {
  try {
    console.log('Starting blockchain rooms cleanup...');
    
    // Pobierz wszystkie aktywne pokoje
    const activeRoomAddresses = new Set(
      Array.from(activeRooms.values()).map(room => room.roomAddress)
    );
    
    // Sprawdź pokoje na blockchainie dla różnych użytkowników
    // To wymaga listy adresów użytkowników - można to rozbudować
    // Na razie pomijamy automatyczne czyszczenie blockchain
    
    console.log('Blockchain cleanup check completed');
  } catch (error) {
    console.error('Error cleaning up blockchain rooms:', error);
  }
}

// Zmień automatyczne czyszczenie aby było bardziej agresywne
setInterval(() => {
  const now = Date.now();
  const fifteenMinutesAgo = now - (15 * 60 * 1000); // 15 minut
  let cleaned = 0;
  
  for (const [roomId, room] of activeRooms) {
    const roomAge = now - new Date(room.createdAt).getTime();
    
    // Usuń pokoje które:
    // - Zostały utworzone ponad 15 minut temu i nie rozpoczęły się
    // - LUB mają zwycięzcę (gra się zakończyła)
    // - LUB zostały anulowane
    if ((roomAge > fifteenMinutesAgo && !room.gameStarted && room.players.length === 1) || 
        room.winner || 
        room.cancelled) {
      activeRooms.delete(roomId);
      
      // Usuń też grę jeśli istnieje
      const game = games.get(roomId);
      if (game) {
        game.stop();
        games.delete(roomId);
      }
      
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`Auto-cleaned ${cleaned} inactive rooms`);
    io.emit('rooms_update', Array.from(activeRooms.values()));
  }
}, 5 * 60 * 1000); // Co 5 minut

// Dodaj też czyszczenie przy starcie serwera
setTimeout(() => {
  console.log('Initial cleanup of old rooms...');
  const cleaned = activeRooms.size;
  activeRooms.clear();
  games.clear();
  if (cleaned > 0) {
    console.log(`Cleaned ${cleaned} rooms on startup`);
  }
}, 1000);

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Solana.io server running on port ${PORT}`);
  console.log(`Connected to Solana ${SOLANA_NETWORK}`);
  console.log(`Program ID: ${PROGRAM_ID.toString()}`);
  console.log(`Server URL: http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log(`  GET  http://localhost:${PORT}/api/rooms`);
  console.log(`  GET  http://localhost:${PORT}/api/rooms/:id`);
  console.log(`  POST http://localhost:${PORT}/api/rooms`);
  console.log(`  POST http://localhost:${PORT}/api/rooms/:id/join`);
  console.log(`  POST http://localhost:${PORT}/api/rooms/:id/start`);
});