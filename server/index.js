// server/index.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const { 
  Connection, 
  PublicKey, 
  clusterApiUrl,
  Keypair,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction
} = require('@solana/web3.js');
const fs = require('fs');
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

// Załaduj server wallet jeśli istnieje
let serverWallet = null;
try {
  if (process.env.SERVER_WALLET_PATH && fs.existsSync(process.env.SERVER_WALLET_PATH)) {
    const walletData = JSON.parse(fs.readFileSync(process.env.SERVER_WALLET_PATH, 'utf8'));
    serverWallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    console.log('Server wallet loaded:', serverWallet.publicKey.toString());
  } else {
    console.warn('No server wallet configured. Automatic blockchain updates disabled.');
  }
} catch (error) {
  console.error('Error loading server wallet:', error);
}

// Funkcja do aktualizacji wartości gracza na blockchain
async function updatePlayerValueOnChain(eaterAddress, eatenAddress, eatenValue) {
  if (!serverWallet) {
    console.log('No server wallet - skipping blockchain update');
    return null;
  }
  
  try {
    console.log('Updating player value on chain:', {
      eater: eaterAddress,
      eaten: eatenAddress,
      value: eatenValue
    });
    
    // Znajdź PDA
    const [gamePDA] = await PublicKey.findProgramAddress(
      [Buffer.from('global_game')],
      PROGRAM_ID
    );
    
    const eaterPubkey = new PublicKey(eaterAddress);
    const eatenPubkey = new PublicKey(eatenAddress);
    
    const [eaterStatePDA] = await PublicKey.findProgramAddress(
      [Buffer.from('player_state'), eaterPubkey.toBuffer()],
      PROGRAM_ID
    );
    
    const [eatenStatePDA] = await PublicKey.findProgramAddress(
      [Buffer.from('player_state'), eatenPubkey.toBuffer()],
      PROGRAM_ID
    );
    
    // Serializuj dane instrukcji
    const instructionData = Buffer.alloc(1 + 32 + 32 + 8);
    instructionData.writeUInt8(2, 0); // UpdatePlayerValue instruction
    eaterPubkey.toBuffer().copy(instructionData, 1);
    eatenPubkey.toBuffer().copy(instructionData, 33);
    instructionData.writeBigUInt64LE(BigInt(eatenValue), 65);
    
    // Utwórz instrukcję
    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: serverWallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: eaterStatePDA, isSigner: false, isWritable: true },
        { pubkey: eatenStatePDA, isSigner: false, isWritable: true },
        { pubkey: gamePDA, isSigner: false, isWritable: true },
      ],
      programId: PROGRAM_ID,
      data: instructionData
    });
    
    // Utwórz i wyślij transakcję
    const transaction = new Transaction().add(instruction);
    
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [serverWallet],
      { commitment: 'confirmed' }
    );
    
    console.log('Player value updated on chain. Signature:', signature);
    return signature;
    
  } catch (error) {
    console.error('Error updating player value on chain:', error);
    return null;
  }
}

// Pojedyncza globalna instancja gry
const globalGame = new GameEngine();

// Ustaw callback dla aktualizacji blockchain
globalGame.onPlayerEaten = async (eaterAddress, eatenAddress, eatenValue) => {
  console.log('Player eaten callback triggered');
  await updatePlayerValueOnChain(eaterAddress, eatenAddress, eatenValue);
};

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

// Admin endpoints (zabezpiecz je w produkcji!)
app.post('/api/admin/force-remove-player', async (req, res) => {
  try {
    const { playerAddress } = req.body;
    
    console.log('Admin: Force removing player:', playerAddress);
    
    // Usuń z gry
    const player = globalGame.players.get(playerAddress);
    if (player) {
      globalGame.players.delete(playerAddress);
      globalGame.totalSolInGame -= player.solValue;
      console.log(`Player ${playerAddress} force removed. Had ${player.solValue} lamports`);
    }
    
    // Usuń mapowania socketów
    const socketId = playerSockets.get(playerAddress);
    if (socketId) {
      playerSockets.delete(playerAddress);
      socketPlayers.delete(socketId);
    }
    
    res.json({ 
      success: true, 
      message: `Player ${playerAddress} removed from game`,
      removedSol: player ? player.solValue : 0
    });
  } catch (error) {
    console.error('Error force removing player:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/active-players', (req, res) => {
  const players = Array.from(globalGame.players.values()).map(p => ({
    address: p.address,
    nickname: p.nickname,
    solValue: p.solValue,
    solDisplay: (p.solValue / 1000000000).toFixed(4),
    isAlive: p.isAlive,
    mass: Math.floor(p.mass),
    position: `${Math.floor(p.x)}, ${Math.floor(p.y)}`
  }));
  
  res.json({
    totalPlayers: players.length,
    totalSolInGame: (globalGame.totalSolInGame / 1000000000).toFixed(4),
    players
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    gameActive: globalGame.isRunning,
    activePlayers: globalGame.players.size,
    serverWallet: serverWallet ? serverWallet.publicKey.toString() : 'not configured'
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
  let broadcastCount = 0;
  for (const [playerAddress, socketId] of playerSockets) {
    const playerView = globalGame.getPlayerView(playerAddress);
    
    if (!playerView) {
      // Gracz został zjedzony - wyślij event eliminacji
      const player = globalGame.players.get(playerAddress);
      if (!player || !player.isAlive) {
        io.to(socketId).emit('player_eliminated', {
          playerAddress,
          reason: 'You were eaten by another player!'
        });
        // Usuń mapowania dla zjedzonego gracza
        playerSockets.delete(playerAddress);
        socketPlayers.delete(socketId);
      }
      continue;
    }
    
    io.to(socketId).emit('player_view', playerView);
    broadcastCount++;
  }
  
  // Log co 5 sekund
  if (Date.now() % 5000 < 16) {
    console.log(`Broadcasting to ${broadcastCount} players, game state:`, {
      activePlayers: gameState.playerCount,
      totalPlayers: playerSockets.size,
      foodCount: gameState.foodCount
    });
  }
}

// Broadcast co 16ms (60 FPS dla klientów)
setInterval(broadcastGameState, 16);

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
  console.log(`Server wallet: ${serverWallet ? serverWallet.publicKey.toString() : 'not configured'}`);
  console.log('Global game is active and running!');
});