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
const PROGRAM_ID = new PublicKey(process.env.SOLANA_PROGRAM_ID || 'EhP1ossEJvx2hrRWhbsQDUVoUoFbWGjap3uxZsjMaknH');

const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

// Pojedyncza globalna instancja gry
const globalGame = new GameEngine();
globalGame.start();

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
    
    console.log('Player joining game:', {
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
    // Zapisz mapowanie
    playerSockets.set(playerAddress, socket.id);
    socketPlayers.set(socket.id, { playerAddress, nickname });
    
    // Dołącz do globalnej gry
    socket.join('game');
    
    // Dodaj gracza do gry
    const player = globalGame.addPlayer(playerAddress, nickname, initialStake);
    
    console.log(`Player ${playerAddress} (${nickname}) joined game with stake: ${initialStake}`);
    
    // Wyślij potwierdzenie
    socket.emit('joined_game', {
      success: true,
      player: player.toJSON()
    });
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
  
  // Wyślij globalny stan do wszystkich
  io.to('game').emit('game_state', gameState);
  
  // Wyślij spersonalizowany widok każdemu graczowi
  for (const [playerAddress, player] of globalGame.players) {
    const socketId = playerSockets.get(playerAddress);
    
    if (socketId) {
      const playerView = globalGame.getPlayerView(playerAddress);
      io.to(socketId).emit('player_view', playerView);
      
      // Jeśli gracz został zjedzony ale jeszcze o tym nie wie
      if (!player.isAlive && player.lastDeathNotification !== true) {
        io.to(socketId).emit('player_eliminated', {
          playerAddress,
          canRespawn: player.solValue > 0,
          currentValue: player.solValue,
          currentValueSol: player.getCurrentValueInSol()
        });
        player.lastDeathNotification = true;
      }
    }
  }
  
  // Sprawdź czy były jakieś zjedzenia graczy i zaktualizuj blockchain
  const collisionUpdates = globalGame.checkCollisions();
  for (const update of collisionUpdates) {
    // TODO: Wywołaj aktualizację na blockchainie
    console.log('Player value update needed:', update);
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