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

// Middleware do logowania
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
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// Konfiguracja Solana
const SOLANA_NETWORK = process.env.SOLANA_NETWORK || 'devnet';
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || clusterApiUrl(SOLANA_NETWORK);
const PROGRAM_ID = new PublicKey(process.env.SOLANA_PROGRAM_ID || '7rw6uErfMmgnwZWs3UReFGc1aBtbM152WkV8kudY9aMd');

const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

// Pojedyncza globalna instancja gry
const globalGame = new GameEngine();
globalGame.start();

console.log('Global game started:', globalGame.isRunning);

// Przechowywanie połączeń graczy
const playerSockets = new Map(); // playerAddress -> socketId
const socketPlayers = new Map(); // socketId -> { playerAddress, nickname }

// Globalny chat
const chatMessages = [];
const MAX_CHAT_MESSAGES = 100;

// API Routes

// Status gry
app.get('/api/game/status', (req, res) => {
  const gameState = globalGame.getGameState();
  res.json({
    status: 'active',
    ...gameState
  });
});

// Dołączanie do gry
app.post('/api/game/join', async (req, res) => {
  try {
    const { playerAddress, initialStake, transactionSignature } = req.body;
    
    console.log('Player joining game via API:', {
      playerAddress,
      initialStake,
      transactionSignature
    });
    
    // TODO: Weryfikacja transakcji na blockchainie
    
    res.json({ 
      success: true,
      playerAddress,
      initialStake
    });
  } catch (error) {
    console.error('Error joining game:', error);
    res.status(500).json({ error: 'Failed to join game', details: error.message });
  }
});

// Cash out
app.post('/api/game/cashout', async (req, res) => {
  try {
    const { playerAddress, transactionSignature } = req.body;
    
    console.log('Player cashing out:', playerAddress);
    
    const cashOutResult = globalGame.handleCashOut(playerAddress);
    if (!cashOutResult) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    res.json({
      success: true,
      ...cashOutResult
    });
  } catch (error) {
    console.error('Error cashing out:', error);
    res.status(500).json({ error: 'Failed to cash out', details: error.message });
  }
});

// Aktualizacja wartości gracza po zjedzeniu
app.post('/api/game/update-value', async (req, res) => {
  try {
    const { eaterAddress, eatenAddress, eatenValue, transactionSignature } = req.body;
    
    console.log('Updating player value:', {
      eaterAddress,
      eatenAddress,
      eatenValue
    });
    
    // TODO: Weryfikacja transakcji na blockchainie
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating value:', error);
    res.status(500).json({ error: 'Failed to update value' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    gameActive: globalGame.isRunning,
    activePlayers: globalGame.players.size
  });
});

// Socket.IO handlers
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  // Chat handlers
  socket.on('join_lobby', ({ playerAddress }) => {
    console.log(`Player ${playerAddress} joined lobby`);
    socket.join('lobby');
    socket.emit('chat_history', chatMessages);
  });
  
  socket.on('leave_lobby', () => {
    socket.leave('lobby');
  });
  
  socket.on('chat_message', ({ playerAddress, message }) => {
    if (!message || message.trim().length === 0) return;
    
    const chatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      playerAddress,
      message: message.trim().substring(0, 200),
      timestamp: new Date().toISOString()
    };
    
    chatMessages.push(chatMessage);
    
    if (chatMessages.length > MAX_CHAT_MESSAGES) {
      chatMessages.shift();
    }
    
    io.to('lobby').emit('new_chat_message', chatMessage);
  });
  
  // Game handlers
  socket.on('join_game', ({ playerAddress, nickname, initialStake }) => {
    console.log('Join game request:', { playerAddress, nickname, initialStake });
    
    // Zapisz mapowanie
    playerSockets.set(playerAddress, socket.id);
    socketPlayers.set(socket.id, { playerAddress, nickname });
    
    console.log('Socket mappings:', {
      playerSockets: playerSockets.size,
      socketId: socket.id,
      playerAddress
    });
    
    // Dołącz do globalnej gry
    socket.join('game');
    
    // Dodaj gracza do gry
    const player = globalGame.addPlayer(playerAddress, nickname, initialStake);
    
    console.log('Player added to game:', {
      playerExists: !!player,
      isAlive: player?.isAlive,
      position: player ? `${player.x}, ${player.y}` : 'N/A'
    });
    
    console.log('Global game state:', {
      totalPlayers: globalGame.players.size,
      activePlayers: Array.from(globalGame.players.values()).filter(p => p.isAlive).length
    });
    
    console.log(`Player ${playerAddress} (${nickname}) joined game with stake: ${initialStake}`);
    
    // Wyślij potwierdzenie
    socket.emit('joined_game', {
      success: true,
      player: player.toJSON()
    });
    
    // Natychmiast wyślij widok gracza
    const playerView = globalGame.getPlayerView(playerAddress);
    if (playerView) {
      console.log('Sending immediate player view to', playerAddress.substring(0, 8));
      socket.emit('player_view', playerView);
    } else {
      console.error('Could not generate player view for', playerAddress);
    }
  });
  
  socket.on('respawn', ({ playerAddress }) => {
    const player = globalGame.players.get(playerAddress);
    if (!player || player.isAlive) return;
    
    // Respawn gracza
    globalGame.addPlayer(playerAddress, player.nickname, 0); // Respawn bez dodatkowej stawki
    
    console.log(`Player ${playerAddress} respawned`);
  });
  
  socket.on('player_input', (data) => {
    const { playerAddress, input } = data;
    
    // Debug log co sekundę
    if (Date.now() % 1000 < 50) {
      console.log(`Input from ${playerAddress.substring(0, 8)}:`, {
        mouseX: input.mouseX?.toFixed(0),
        mouseY: input.mouseY?.toFixed(0),
        split: input.split,
        eject: input.eject
      });
    }
    
    globalGame.updatePlayer(playerAddress, input);
  });
  
  socket.on('cash_out', ({ playerAddress }) => {
    const result = globalGame.handleCashOut(playerAddress);
    
    if (result) {
      socket.emit('cash_out_result', result);
      
      // Usuń mapowania
      playerSockets.delete(playerAddress);
      socketPlayers.delete(socket.id);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    const playerInfo = socketPlayers.get(socket.id);
    if (playerInfo) {
      const { playerAddress } = playerInfo;
      
      // Nie usuwaj gracza z gry - może wrócić
      // Tylko usuń mapowania socketów
      playerSockets.delete(playerAddress);
      socketPlayers.delete(socket.id);
      
      console.log(`Player ${playerAddress} disconnected but remains in game`);
    }
  });
});

// Funkcja broadcastująca stan gry
function broadcastGameState() {
  const gameState = globalGame.getGameState();
  
  // Log co sekundę
  if (Date.now() % 1000 < 50) {
    console.log(`Broadcasting - Players: ${playerSockets.size}, Game running: ${globalGame.isRunning}`);
  }
  
  // Wyślij globalny stan do wszystkich
  io.to('game').emit('game_state', gameState);
  
  // Wyślij spersonalizowany widok każdemu graczowi
  let sentCount = 0;
  for (const [playerAddress, socketId] of playerSockets) {
    const playerView = globalGame.getPlayerView(playerAddress);
    
    if (!playerView) {
      console.error(`No player view for ${playerAddress}`);
      continue;
    }
    
    io.to(socketId).emit('player_view', playerView);
    sentCount++;
    
    // Log raz na sekundę
    if (Date.now() % 1000 < 50) {
      console.log(`Sent view to ${playerAddress.substring(0, 8)}...`);
    }
  }
  
  if (Date.now() % 1000 < 50 && sentCount > 0) {
    console.log(`Broadcast complete - sent ${sentCount} views`);
  }
}

// Broadcast co 50ms (20 FPS dla klientów)
setInterval(broadcastGameState, 50);

// Statystyki gry co minutę
setInterval(() => {
  const stats = globalGame.getGameState();
  console.log('Game statistics:', {
    activePlayers: stats.playerCount,
    totalPlayers: stats.totalPlayers,
    totalSolInGame: stats.totalSolDisplay,
    foodCount: stats.foodCount
  });
}, 60000);

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Solana.io Global Game Server running on port ${PORT}`);
  console.log(`Connected to Solana ${SOLANA_NETWORK}`);
  console.log(`Program ID: ${PROGRAM_ID.toString()}`);
  console.log('Global game is active and running!');
});