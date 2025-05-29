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
const bs58 = require('bs58');
const RoomManager = require('./game/RoomManager');
const DeltaCompressor = require('./networking/DeltaCompressor');
const BinaryProtocol = require('./networking/BinaryProtocol');

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
  allowEIO3: true,
  // Optymalizacje Socket.IO
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  maxHttpBufferSize: 1e6, // 1MB
});

// Konfiguracja Solana
const SOLANA_NETWORK = process.env.SOLANA_NETWORK || 'devnet';
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || clusterApiUrl(SOLANA_NETWORK);
const PROGRAM_ID = new PublicKey(process.env.SOLANA_PROGRAM_ID || 'C4KnupLUR9fLC12sckRY1QsNfb2eWDrfWQmHydLyMN8y');

const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

// Załaduj server wallet
let serverWallet = null;
try {
  // Priorytet 1: Private key z .env
  if (process.env.SERVER_WALLET_PRIVATE_KEY) {
    try {
      // Dekoduj private key z base58
      const privateKey = bs58.decode(process.env.SERVER_WALLET_PRIVATE_KEY);
      serverWallet = Keypair.fromSecretKey(privateKey);
      console.log('Server wallet loaded from private key:', serverWallet.publicKey.toString());
    } catch (error) {
      console.error('Error decoding private key:', error);
      console.log('Trying to parse as array...');
      // Jeśli to jest tablica liczb w formacie JSON
      try {
        const privateKeyArray = JSON.parse(process.env.SERVER_WALLET_PRIVATE_KEY);
        serverWallet = Keypair.fromSecretKey(new Uint8Array(privateKeyArray));
        console.log('Server wallet loaded from array:', serverWallet.publicKey.toString());
      } catch (parseError) {
        console.error('Failed to parse private key:', parseError);
      }
    }
  } 
  // Priorytet 2: Keypair z pliku
  else if (process.env.SERVER_WALLET_PATH && fs.existsSync(process.env.SERVER_WALLET_PATH)) {
    const walletData = JSON.parse(fs.readFileSync(process.env.SERVER_WALLET_PATH, 'utf8'));
    serverWallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    console.log('Server wallet loaded from file:', serverWallet.publicKey.toString());
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

// NOWA FUNKCJA: Force cleanup gracza (bez wypłaty!)
async function forceCleanupPlayer(playerAddress) {
  if (!serverWallet) {
    console.log('No server wallet - cannot force cleanup');
    return null;
  }
  
  try {
    console.log('Force cleanup for player:', playerAddress);
    
    const playerPubkey = new PublicKey(playerAddress);
    
    // Znajdź PDA
    const [gamePDA] = await PublicKey.findProgramAddress(
      [Buffer.from('global_game')],
      PROGRAM_ID
    );
    
    const [playerStatePDA] = await PublicKey.findProgramAddress(
      [Buffer.from('player_state'), playerPubkey.toBuffer()],
      PROGRAM_ID
    );
    
    // Platform fee wallet
    const PLATFORM_FEE_WALLET = new PublicKey('FEEfBE29dqRgC8qMv6f9YXTSNbX7LMN3Reo3UsYdoUd8');
    
    // Serializuj dane instrukcji - ForceCleanup
    const instructionData = Buffer.alloc(1 + 32);
    instructionData.writeUInt8(5, 0); // ForceCleanup instruction (index 5)
    playerPubkey.toBuffer().copy(instructionData, 1);
    
    // Utwórz instrukcję - server wallet jako pierwszy account (authority)
    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: serverWallet.publicKey, isSigner: true, isWritable: true }, // Server authority
        { pubkey: playerStatePDA, isSigner: false, isWritable: true },
        { pubkey: gamePDA, isSigner: false, isWritable: true },
        { pubkey: PLATFORM_FEE_WALLET, isSigner: false, isWritable: false }, // Nie zapisujemy do fee wallet
        { pubkey: playerPubkey, isSigner: false, isWritable: false }, // Gracz nie otrzymuje środków
      ],
      programId: PROGRAM_ID,
      data: instructionData
    });
    
    // Utwórz i wyślij transakcję
    const transaction = new Transaction().add(instruction);
    
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [serverWallet], // Server wallet jako signer
      { commitment: 'confirmed' }
    );
    
    console.log('Player force cleaned up (no payout). Signature:', signature);
    return signature;
    
  } catch (error) {
    console.error('Error force cleanup player:', error);
    
    // Jeśli błąd to że gracz nie jest aktywny, to to jest ok
    if (error.logs && error.logs.some(log => log.includes('Player is not active'))) {
      console.log('Player already inactive, no need to cleanup');
      return 'already_inactive';
    }
    
    return null;
  }
}

// Inicjalizuj Room Manager
const roomManager = new RoomManager();

// Ustaw callback dla aktualizacji blockchain
roomManager.onPlayerEaten = async (eaterAddress, eatenAddress, eatenValue) => {
  console.log('Player eaten callback triggered - updating blockchain');
  const signature = await updatePlayerValueOnChain(eaterAddress, eatenAddress, eatenValue);
  if (signature) {
    console.log('Blockchain update successful:', signature);
  } else {
    console.log('Blockchain update failed - continuing game anyway');
  }
};

// Uruchom cleanup timer
roomManager.startCleanupTimer();

console.log('Multi-room game server initialized:', {
  totalRooms: roomManager.maxRooms,
  maxPlayersPerRoom: roomManager.maxPlayersPerRoom,
  totalCapacity: roomManager.maxRooms * roomManager.maxPlayersPerRoom,
  serverWalletConfigured: !!serverWallet
});

// Przechowywanie połączeń graczy
const playerSockets = new Map(); // playerAddress -> socketId
const socketPlayers = new Map(); // socketId -> { playerAddress, nickname, roomId }

// Delta compressors per player
const deltaCompressors = new Map(); // playerAddress -> DeltaCompressor

// Globalny chat
const chatMessages = [];
const MAX_CHAT_MESSAGES = 100;

// API Routes

// Status gry
app.get('/api/game/status', (req, res) => {
  const gameStats = roomManager.getGlobalStats();
  res.json({
    status: 'active',
    ...gameStats,
    serverWalletConfigured: !!serverWallet,
    serverWalletAddress: serverWallet ? serverWallet.publicKey.toString() : null
  });
});

// Status konkretnego pokoju
app.get('/api/game/room/:roomId/status', (req, res) => {
  const roomId = parseInt(req.params.roomId);
  const room = roomManager.rooms.get(roomId);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const gameState = room.engine.getGameState();
  res.json({
    roomId,
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
    
    // Znajdź pokój gracza
    const room = roomManager.getPlayerRoom(playerAddress);
    if (!room) {
      return res.status(404).json({ error: 'Player not found in any room' });
    }
    
    const cashOutResult = room.engine.handleCashOut(playerAddress);
    if (!cashOutResult) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // Usuń gracza z room managera
    roomManager.removePlayerFromRoom(playerAddress, true);
    
    res.json({
      success: true,
      ...cashOutResult
    });
  } catch (error) {
    console.error('Error cashing out:', error);
    res.status(500).json({ error: 'Failed to cash out', details: error.message });
  }
});

// NOWY ENDPOINT: Force cleanup gracza
app.post('/api/game/force-cleanup', async (req, res) => {
  try {
    const { playerAddress } = req.body;
    
    if (!playerAddress) {
      return res.status(400).json({ error: 'Player address required' });
    }
    
    console.log('Force cleanup requested for player:', playerAddress);
    
    // Usuń gracza ze wszystkich pokoi
    roomManager.removePlayerFromRoom(playerAddress, true);
    
    // Usuń mapowania socketów
    const socketId = playerSockets.get(playerAddress);
    if (socketId) {
      playerSockets.delete(playerAddress);
      socketPlayers.delete(socketId);
      deltaCompressors.delete(playerAddress);
    }
    
    // Jeśli mamy server wallet, spróbuj wyczyścić stan na blockchain
    if (serverWallet) {
      console.log('Attempting blockchain cleanup...');
      const result = await forceCleanupPlayer(playerAddress);
      
      if (result) {
        console.log('Blockchain cleanup successful');
        res.json({ 
          success: true, 
          message: 'Player cleaned up successfully',
          blockchainCleaned: true,
          signature: result !== 'already_inactive' ? result : null
        });
      } else {
        console.log('Blockchain cleanup failed, but game state cleaned');
        res.json({ 
          success: true, 
          message: 'Player cleaned from game engine only',
          blockchainCleaned: false
        });
      }
    } else {
      console.log('No server wallet - cleaned from game engine only');
      res.json({ 
        success: true, 
        message: 'Player cleaned from game engine only',
        blockchainCleaned: false
      });
    }
  } catch (error) {
    console.error('Error in force cleanup:', error);
    res.status(500).json({ error: 'Failed to cleanup player', details: error.message });
  }
});

// Admin endpoints (zabezpiecz je w produkcji!)
app.get('/api/admin/rooms', (req, res) => {
  const rooms = [];
  for (const [roomId, room] of roomManager.rooms) {
    const stats = room.engine.getGameState();
    rooms.push({
      id: roomId,
      players: room.players.size,
      activePlayers: stats.playerCount,
      totalSol: stats.totalSolDisplay,
      performance: stats.performance,
      lastActivity: room.lastActivity
    });
  }
  
  res.json({
    rooms,
    globalStats: roomManager.getGlobalStats()
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    rooms: roomManager.rooms.size,
    totalPlayers: playerSockets.size,
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
    
    // Sprawdź czy gracz już jest w jakimś pokoju
    const existingRoom = roomManager.getPlayerRoom(playerAddress);
    
    if (existingRoom) {
      const player = existingRoom.engine.players.get(playerAddress);
      
      if (player && player.isAlive) {
        if (initialStake > 0) {
          // Próbuje dołączyć z nową stawką mimo że żyje
          console.log(`Player ${playerAddress} is already alive in room ${existingRoom.id}`);
          socket.emit('error', {
            message: 'You are already active in the game. Please cash out first.'
          });
          return;
        } else {
          // Reconnect do istniejącej sesji
          playerSockets.set(playerAddress, socket.id);
          socketPlayers.set(socket.id, { 
            playerAddress, 
            nickname,
            roomId: existingRoom.id 
          });
          socket.join(`room-${existingRoom.id}`);
          socket.join('game');
          
          // Inicjalizuj delta compressor dla tego gracza
          if (!deltaCompressors.has(playerAddress)) {
            deltaCompressors.set(playerAddress, new DeltaCompressor());
          }
          
          console.log(`Player ${playerAddress} reconnected to room ${existingRoom.id}`);
          
          socket.emit('joined_game', {
            success: true,
            roomId: existingRoom.id,
            player: player.toJSON()
          });
          return;
        }
      }
    }
    
    // Przydziel gracza do pokoju
    const room = roomManager.assignPlayerToRoom(playerAddress, nickname, initialStake);
    
    if (!room) {
      socket.emit('error', {
        message: 'All game rooms are full. Please try again later.'
      });
      return;
    }
    
    // Zapisz mapowania
    playerSockets.set(playerAddress, socket.id);
    socketPlayers.set(socket.id, { 
      playerAddress, 
      nickname,
      roomId: room.id 
    });
    
    // Dołącz do pokoju socket.io
    socket.join(`room-${room.id}`);
    socket.join('game');
    
    // Inicjalizuj delta compressor dla tego gracza
    deltaCompressors.set(playerAddress, new DeltaCompressor());
    
    const player = room.engine.players.get(playerAddress);
    
    console.log(`Player ${playerAddress} (${nickname}) joined room ${room.id}`);
    
    socket.emit('joined_game', {
      success: true,
      roomId: room.id,
      player: player ? player.toJSON() : null
    });
  });
  
  socket.on('player_input', (data) => {
    const { playerAddress, input } = data;
    const engine = roomManager.getPlayerEngine(playerAddress);
    if (engine) {
      engine.updatePlayer(playerAddress, input);
    }
  });
  
  socket.on('initiate_cash_out', ({ playerAddress }) => {
    console.log('Player initiating cash out:', playerAddress);
    
    const engine = roomManager.getPlayerEngine(playerAddress);
    const player = engine ? engine.players.get(playerAddress) : null;
    
    if (!player || !player.isAlive) {
      socket.emit('cash_out_initiated', {
        success: false,
        error: 'Player not found or already dead'
      });
      return;
    }
    
    // Oznacz gracza jako "cashing out" - to zapobiegnie zjedzeniu
    player.isCashingOut = true;
    
    // WAŻNE: Zapisz AKTUALNĄ wartość gracza (po zjedzeniu innych)
    const cashOutAmount = player.solValue;
    const cashOutAmountSol = cashOutAmount / 1000000000;
    
    console.log(`Player ${playerAddress} cashing out with:`);
    console.log(`- Current value: ${cashOutAmount} lamports (${cashOutAmountSol} SOL)`);
    console.log(`- Initial stake: ${player.initialStake} lamports`);
    console.log(`- Players eaten: ${player.playersEaten}`);
    console.log(`- Total earned: ${player.totalSolEarned} lamports`);
    
    // Usuń gracza z gry
    roomManager.removePlayerFromRoom(playerAddress, true);
    
    // Usuń mapowania socketów
    playerSockets.delete(playerAddress);
    socketPlayers.delete(socket.id);
    deltaCompressors.delete(playerAddress);
    
    socket.emit('cash_out_initiated', {
      success: true,
      amount: cashOutAmount, // Przekaż AKTUALNĄ wartość!
      playerAddress,
      debug: {
        initialStake: player.initialStake,
        currentValue: cashOutAmount,
        playersEaten: player.playersEaten,
        totalEarned: player.totalSolEarned
      }
    });
  });
  
  socket.on('cash_out', ({ playerAddress }) => {
    // To jest teraz tylko do potwierdzenia - gracz już został usunięty
    console.log('Cash out confirmed for:', playerAddress);
    
    const result = {
      address: playerAddress,
      success: true
    };
    
    socket.emit('cash_out_result', result);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    const playerInfo = socketPlayers.get(socket.id);
    if (playerInfo) {
      const { playerAddress } = playerInfo;
      
      // Sprawdź czy gracz istnieje i żyje
      const engine = roomManager.getPlayerEngine(playerAddress);
      const player = engine ? engine.players.get(playerAddress) : null;
      
      if (player && player.isAlive) {
        // Gracz żyje - zachowaj go w grze
        console.log(`Player ${playerAddress} disconnected but remains in game`);
      } else {
        // Gracz nie istnieje lub nie żyje - wyczyść wszystko
        console.log(`Cleaning up disconnected player ${playerAddress}`);
        if (player && !player.isAlive) {
          roomManager.removePlayerFromRoom(playerAddress, false);
        }
      }
      
      // Zawsze usuń mapowania socketów przy disconnect
      playerSockets.delete(playerAddress);
      socketPlayers.delete(socket.id);
      deltaCompressors.delete(playerAddress);
    }
  });
});

// Funkcja broadcastująca stan gry - OPTYMALIZOWANA
function broadcastGameState() {
  const globalState = roomManager.getGlobalStats();
  
  // Wyślij globalny stan do wszystkich w lobby
  io.to('lobby').emit('global_stats', globalState);
  
  // Broadcast per room
  for (const [roomId, room] of roomManager.rooms) {
    const gameState = room.engine.getGameState();
    
    // Wyślij stan pokoju do wszystkich w tym pokoju
    io.to(`room-${roomId}`).emit('room_state', gameState);
    
    // Wyślij spersonalizowany widok każdemu graczowi w pokoju
    for (const playerAddress of room.players) {
      const socketId = playerSockets.get(playerAddress);
      if (!socketId) continue;
      
      const playerView = room.engine.getPlayerView(playerAddress);
      
      if (!playerView) {
        // Gracz nie ma widoku - został zjedzony lub nie istnieje
        const player = room.engine.players.get(playerAddress);
        
        if (!player) {
          // Wyślij event eliminacji
          io.to(socketId).emit('player_eliminated', {
            playerAddress,
            reason: 'You were eaten by another player!'
          });
          
          // Usuń mapowania
          roomManager.removePlayerFromRoom(playerAddress, false);
          playerSockets.delete(playerAddress);
          const socketPlayer = socketPlayers.get(socketId);
          if (socketPlayer) {
            socketPlayers.delete(socketId);
          }
          deltaCompressors.delete(playerAddress);
          
          console.log(`Removed socket mappings for eaten player ${playerAddress}`);
        }
        continue;
      }
      
      // Użyj delta compression jeśli możliwe
      const deltaCompressor = deltaCompressors.get(playerAddress);
      if (deltaCompressor && process.env.USE_DELTA_COMPRESSION === 'true') {
        const delta = deltaCompressor.computeDelta(playerAddress, playerView);
        io.to(socketId).emit('player_delta', delta);
      } else {
        io.to(socketId).emit('player_view', playerView);
      }
    }
  }
  
  // Log co 5 sekund
  if (Date.now() % 5000 < 16) {
    console.log('Broadcasting game state:', {
      totalRooms: roomManager.rooms.size,
      totalPlayers: globalState.totalPlayers,
      totalActivePlayers: globalState.totalActivePlayers,
      totalSol: globalState.totalSolDisplay,
      capacityUsed: globalState.capacityUsed + '%'
    });
  }
}

// Broadcast co 16ms (60 FPS dla klientów)
setInterval(broadcastGameState, 16);

// Statystyki gry co minutę
setInterval(() => {
  const stats = roomManager.getGlobalStats();
  console.log('=== GAME STATISTICS ===');
  console.log('Total rooms:', stats.totalRooms);
  console.log('Total players:', stats.totalPlayers);
  console.log('Active players:', stats.totalActivePlayers);
  console.log('Total SOL in game:', stats.totalSolDisplay);
  console.log('Average players per room:', stats.averagePlayersPerRoom);
  console.log('Capacity used:', stats.capacityUsed + '%');
  console.log('Server wallet:', serverWallet ? serverWallet.publicKey.toString() : 'not configured');
  console.log('=======================');
}, 60000);

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Solana.io Multi-Room Game Server running on port ${PORT}`);
  console.log(`Connected to Solana ${SOLANA_NETWORK}`);
  console.log(`Program ID: ${PROGRAM_ID.toString()}`);
  console.log(`Server wallet: ${serverWallet ? serverWallet.publicKey.toString() : 'not configured'}`);
  console.log(`Blockchain updates: ${serverWallet ? 'ENABLED' : 'DISABLED'}`);
  console.log(`Total capacity: ${roomManager.maxRooms} rooms x ${roomManager.maxPlayersPerRoom} players = ${roomManager.maxRooms * roomManager.maxPlayersPerRoom} players`);
  console.log('Multi-room system is active!');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  roomManager.stopAll();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});