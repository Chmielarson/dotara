// src/utils/SolanaTransactions.js
import { 
  Connection, 
  SystemProgram, 
  Transaction, 
  PublicKey, 
  LAMPORTS_PER_SOL,
  clusterApiUrl,
  TransactionInstruction
} from '@solana/web3.js';
import io from 'socket.io-client';
import { Buffer } from 'buffer';

// Konfiguracja
const NETWORK = process.env.REACT_APP_SOLANA_NETWORK || 'devnet';
const connection = new Connection(clusterApiUrl(NETWORK), 'confirmed');
const GAME_SERVER_URL = process.env.REACT_APP_GAME_SERVER_URL || 'http://localhost:3001';
const PROGRAM_ID = new PublicKey(process.env.REACT_APP_PROGRAM_ID || 'YOUR_PROGRAM_ID_HERE');
const SYSVAR_RENT_PUBKEY = new PublicKey('SysvarRent111111111111111111111111111111111');
const PLATFORM_FEE_WALLET = new PublicKey('FEEfBE29dqRgC8qMv6f9YXTSNbX7LMN3Reo3UsYdoUd8');

let socket = null;

// ========== SERIALIZACJA DANYCH ==========

function serializeCreateRoomData(maxPlayers, entryFee, roomSlot, gameDuration, mapSize) {
  // 1 + 1 + 8 + 1 + 2 + 2 = 15 bajtów
  const buffer = Buffer.alloc(15);
  
  buffer.writeUInt8(0, 0); // CreateRoom instruction
  buffer.writeUInt8(maxPlayers, 1);
  buffer.writeBigUInt64LE(BigInt(Math.round(entryFee * LAMPORTS_PER_SOL)), 2);
  buffer.writeUInt8(roomSlot, 10);
  buffer.writeUInt16LE(gameDuration, 11);
  buffer.writeUInt16LE(mapSize, 13);
  
  return buffer;
}

function serializeJoinRoomData() {
  const buffer = Buffer.alloc(1);
  buffer.writeUInt8(1, 0); // JoinRoom instruction
  return buffer;
}

function serializeStartGameData(gameId) {
  const gameIdBytes = Buffer.from(gameId, 'utf8');
  const buffer = Buffer.alloc(1 + 4 + gameIdBytes.length);
  
  buffer.writeUInt8(2, 0); // StartGame instruction
  buffer.writeUInt32LE(gameIdBytes.length, 1);
  gameIdBytes.copy(buffer, 5);
  
  return buffer;
}

function serializeEliminatePlayerData(playerPubkey) {
  const buffer = Buffer.alloc(1 + 32);
  buffer.writeUInt8(3, 0); // EliminatePlayer instruction
  playerPubkey.toBuffer().copy(buffer, 1);
  return buffer;
}

function serializeEndGameData(winnerPubkey) {
  const buffer = Buffer.alloc(1 + 32);
  buffer.writeUInt8(4, 0); // EndGame instruction
  winnerPubkey.toBuffer().copy(buffer, 1);
  return buffer;
}

function serializeClaimPrizeData() {
  const buffer = Buffer.alloc(1);
  buffer.writeUInt8(5, 0); // ClaimPrize instruction
  return buffer;
}

// ========== FUNKCJE POMOCNICZE ==========

async function findGamePDA(creatorPubkey, roomSlot = 0) {
  return await PublicKey.findProgramAddress(
    [Buffer.from('solana_io'), creatorPubkey.toBuffer(), Buffer.from([roomSlot])],
    PROGRAM_ID
  );
}

function initializeSocket() {
  if (socket && socket.connected) return socket;
  
  if (!socket) {
    socket = io(GAME_SERVER_URL, {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      transports: ['websocket', 'polling']
    });
    
    socket.on('connect', () => {
      console.log('Connected to game server');
    });
    
    socket.on('disconnect', () => {
      console.log('Disconnected from game server');
    });
  }
  
  if (!socket.connected) {
    socket.connect();
  }
  
  return socket;
}

// ========== API FUNCTIONS ==========

export async function getRooms() {
  const response = await fetch(`${GAME_SERVER_URL}/api/rooms`);
  if (!response.ok) throw new Error('Failed to fetch rooms');
  return response.json();
}

export function getRoomsUpdates(callback) {
  const socket = initializeSocket();
  
  socket.off('rooms_update');
  socket.on('rooms_update', callback);
  socket.emit('get_rooms');
  
  return () => socket.off('rooms_update');
}

export async function createRoom(maxPlayers, entryFee, mapSize, gameDuration, wallet) {
  const { publicKey, signTransaction } = wallet;
  
  if (!publicKey) throw new Error('Wallet not connected');
  
  // Znajdź wolny slot
  let roomSlot = 0;
  let gamePDA = null;
  let bump = null;
  
  for (let slot = 0; slot < 10; slot++) {
    const [pda, bumpSeed] = await findGamePDA(publicKey, slot);
    
    try {
      const accountInfo = await connection.getAccountInfo(pda);
      if (!accountInfo) {
        roomSlot = slot;
        gamePDA = pda;
        bump = bumpSeed;
        break;
      }
    } catch {
      roomSlot = slot;
      gamePDA = pda;
      bump = bumpSeed;
      break;
    }
  }
  
  if (!gamePDA) throw new Error('All room slots are occupied');
  
  // Serializuj dane
  const data = serializeCreateRoomData(maxPlayers, entryFee, roomSlot, gameDuration, mapSize);
  
  // Utwórz instrukcję
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: publicKey, isSigner: true, isWritable: true },
      { pubkey: gamePDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: data
  });
  
  // Utwórz i wyślij transakcję
  const transaction = new Transaction().add(instruction);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = publicKey;
  
  const signedTransaction = await signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signedTransaction.serialize());
  
  await connection.confirmTransaction({
    blockhash,
    lastValidBlockHeight,
    signature
  }, 'confirmed');
  
  // Zarejestruj na serwerze
  const response = await fetch(`${GAME_SERVER_URL}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creatorAddress: publicKey.toString(),
      maxPlayers,
      entryFee,
      roomAddress: gamePDA.toString(),
      mapSize,
      gameDuration,
      transactionSignature: signature
    })
  });
  
  const roomData = await response.json();
  return roomData.roomId;
}

export async function joinRoom(roomId, entryFee, wallet) {
  const { publicKey, signTransaction } = wallet;
  
  if (!publicKey) throw new Error('Wallet not connected');
  
  // Pobierz dane pokoju
  const response = await fetch(`${GAME_SERVER_URL}/api/rooms/${roomId}`);
  const roomData = await response.json();
  
  const roomPDA = new PublicKey(roomData.roomAddress);
  const data = serializeJoinRoomData();
  
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: publicKey, isSigner: true, isWritable: true },
      { pubkey: roomPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: data
  });
  
  const transaction = new Transaction().add(instruction);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = publicKey;
  
  const signedTransaction = await signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signedTransaction.serialize());
  
  await connection.confirmTransaction({
    blockhash,
    lastValidBlockHeight,
    signature
  }, 'confirmed');
  
  // Powiadom serwer
  await fetch(`${GAME_SERVER_URL}/api/rooms/${roomId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerAddress: publicKey.toString(),
      transactionSignature: signature
    })
  });
  
  return { success: true };
}

export async function startGame(roomId, wallet) {
  const { publicKey, signTransaction } = wallet;
  
  if (!publicKey) throw new Error('Wallet not connected');
  
  const response = await fetch(`${GAME_SERVER_URL}/api/rooms/${roomId}`);
  const roomData = await response.json();
  
  const gameId = `game_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  const roomPDA = new PublicKey(roomData.roomAddress);
  const data = serializeStartGameData(gameId);
  
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: publicKey, isSigner: true, isWritable: true },
      { pubkey: roomPDA, isSigner: false, isWritable: true },
    ],
    programId: PROGRAM_ID,
    data: data
  });
  
  const transaction = new Transaction().add(instruction);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = publicKey;
  
  const signedTransaction = await signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signedTransaction.serialize());
  
  await connection.confirmTransaction({
    blockhash,
    lastValidBlockHeight,
    signature
  }, 'confirmed');
  
  // Powiadom serwer
  await fetch(`${GAME_SERVER_URL}/api/rooms/${roomId}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gameId,
      initiatorAddress: publicKey.toString(),
      transactionSignature: signature
    })
  });
  
  return gameId;
}

export async function endGame(roomId, winnerAddress, wallet) {
  const { publicKey, signTransaction } = wallet;
  
  if (!publicKey) throw new Error('Wallet not connected');
  
  const response = await fetch(`${GAME_SERVER_URL}/api/rooms/${roomId}`);
  const roomData = await response.json();
  
  if (roomData.blockchainEnded) return { success: true, alreadyEnded: true };
  
  const roomPDA = new PublicKey(roomData.roomAddress);
  const winnerPubkey = new PublicKey(winnerAddress);
  const data = serializeEndGameData(winnerPubkey);
  
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: publicKey, isSigner: true, isWritable: true },
      { pubkey: roomPDA, isSigner: false, isWritable: true },
    ],
    programId: PROGRAM_ID,
    data: data
  });
  
  const transaction = new Transaction().add(instruction);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = publicKey;
  
  const signedTransaction = await signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signedTransaction.serialize());
  
  await connection.confirmTransaction({
    blockhash,
    lastValidBlockHeight,
    signature
  }, 'confirmed');
  
  // Powiadom serwer
  await fetch(`${GAME_SERVER_URL}/api/rooms/${roomId}/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      winnerAddress,
      transactionSignature: signature
    })
  });
  
  return { success: true };
}

export async function claimPrize(roomId, wallet) {
  const { publicKey, signTransaction } = wallet;
  
  if (!publicKey) throw new Error('Wallet not connected');
  
  const response = await fetch(`${GAME_SERVER_URL}/api/rooms/${roomId}`);
  const roomData = await response.json();
  
  if (roomData.winner !== publicKey.toString()) {
    throw new Error('Only winner can claim prize');
  }
  
  const roomPDA = new PublicKey(roomData.roomAddress);
  const totalPrize = roomData.entryFee * roomData.players.length;
  const platformFee = totalPrize * 0.05;
  const winnerPrize = totalPrize * 0.95;
  
  const data = serializeClaimPrizeData();
  
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: publicKey, isSigner: true, isWritable: true },
      { pubkey: roomPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: PLATFORM_FEE_WALLET, isSigner: false, isWritable: true },
    ],
    programId: PROGRAM_ID,
    data: data
  });
  
  const transaction = new Transaction().add(instruction);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = publicKey;
  
  const signedTransaction = await signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signedTransaction.serialize());
  
  await connection.confirmTransaction({
    blockhash,
    lastValidBlockHeight,
    signature
  }, 'confirmed');
  
  return {
    winner: publicKey.toString(),
    prize: winnerPrize,
    platformFee: platformFee,
    totalPrize: totalPrize,
    claimedAt: new Date().toISOString()
  };
}

export function connectToGameServer(roomId, playerAddress) {
  const socket = initializeSocket();
  return socket;
}

export { socket };