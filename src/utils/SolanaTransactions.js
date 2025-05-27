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
const NETWORK = 'devnet';
const connection = new Connection(clusterApiUrl(NETWORK), 'confirmed');

// Hardcoded URL
const GAME_SERVER_URL = 'http://localhost:3001';

console.log('Using game server URL:', GAME_SERVER_URL);

// Program ID
const PROGRAM_ID = new PublicKey('5vGU3fqNat5z6v7MHMT7Zb9v9Q788geefMXUsSCszQ6M');
const PLATFORM_FEE_WALLET = new PublicKey('FEEfBE29dqRgC8qMv6f9YXTSNbX7LMN3Reo3UsYdoUd8');

console.log('Solana configuration loaded:', {
  NETWORK,
  PROGRAM_ID: PROGRAM_ID.toString(),
  GAME_SERVER_URL
});

// ========== SERIALIZACJA DANYCH ==========

function serializeInitializeGameData() {
  const buffer = Buffer.alloc(1);
  buffer.writeUInt8(0, 0); // InitializeGame instruction
  return buffer;
}

function serializeJoinGameData(stakeAmount) {
  const buffer = Buffer.alloc(1 + 8);
  buffer.writeUInt8(1, 0); // JoinGame instruction
  const lamportsAmount = Math.floor(stakeAmount * LAMPORTS_PER_SOL);
  buffer.writeBigUInt64LE(BigInt(lamportsAmount), 1);
  return buffer;
}

function serializeUpdatePlayerValueData(player, eatenPlayer, eatenValue) {
  const buffer = Buffer.alloc(1 + 32 + 32 + 8);
  buffer.writeUInt8(2, 0); // UpdatePlayerValue instruction
  player.toBuffer().copy(buffer, 1);
  eatenPlayer.toBuffer().copy(buffer, 33);
  buffer.writeBigUInt64LE(BigInt(eatenValue), 65);
  return buffer;
}

function serializeCashOutData() {
  const buffer = Buffer.alloc(1);
  buffer.writeUInt8(3, 0); // CashOut instruction
  return buffer;
}

// ========== FUNKCJE POMOCNICZE ==========

async function findGlobalGamePDA() {
  return await PublicKey.findProgramAddress(
    [Buffer.from('global_game')],
    PROGRAM_ID
  );
}

async function findPlayerStatePDA(playerPubkey) {
  return await PublicKey.findProgramAddress(
    [Buffer.from('player_state'), playerPubkey.toBuffer()],
    PROGRAM_ID
  );
}

// ========== API FUNCTIONS ==========

// Inicjalizacja globalnej gry (tylko raz, przez admina)
export async function initializeGlobalGame(wallet) {
  const { publicKey, signTransaction } = wallet;
  
  if (!publicKey) throw new Error('Wallet not connected');
  
  const [gamePDA] = await findGlobalGamePDA();
  
  // Sprawdź czy gra już istnieje
  const accountInfo = await connection.getAccountInfo(gamePDA);
  if (accountInfo) {
    console.log('Global game already initialized');
    return { alreadyInitialized: true };
  }
  
  const data = serializeInitializeGameData();
  
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: publicKey, isSigner: true, isWritable: true },
      { pubkey: gamePDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false },
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
  
  console.log('Global game initialized:', signature);
  
  return { success: true, signature };
}

// Dołączanie do globalnej gry
export async function joinGlobalGame(stakeAmount, wallet) {
  const { publicKey, signTransaction } = wallet;
  
  if (!publicKey) throw new Error('Wallet not connected');
  
  const [gamePDA] = await findGlobalGamePDA();
  const [playerStatePDA] = await findPlayerStatePDA(publicKey);
  
  console.log('Joining global game:', {
    stakeAmount,
    gamePDA: gamePDA.toString(),
    playerStatePDA: playerStatePDA.toString()
  });
  
  const data = serializeJoinGameData(stakeAmount);
  
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: publicKey, isSigner: true, isWritable: true },
      { pubkey: playerStatePDA, isSigner: false, isWritable: true },
      { pubkey: gamePDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false },
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
  
  console.log('Transaction sent:', signature);
  
  await connection.confirmTransaction({
    blockhash,
    lastValidBlockHeight,
    signature
  }, 'confirmed');
  
  console.log('Transaction confirmed');
  
  // Powiadom serwer
  const response = await fetch(`${GAME_SERVER_URL}/api/game/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerAddress: publicKey.toString(),
      initialStake: Math.floor(stakeAmount * LAMPORTS_PER_SOL),
      transactionSignature: signature
    })
  });
  
  if (!response.ok) {
    throw new Error('Failed to register with game server');
  }
  
  return {
    success: true,
    signature,
    stakeInLamports: Math.floor(stakeAmount * LAMPORTS_PER_SOL)
  };
}

// Aktualizacja wartości gracza po zjedzeniu
export async function updatePlayerValue(eaterAddress, eatenAddress, eatenValue, wallet) {
  const { publicKey, signTransaction } = wallet;
  
  if (!publicKey) throw new Error('Wallet not connected');
  
  const [gamePDA] = await findGlobalGamePDA();
  const eaterPubkey = new PublicKey(eaterAddress);
  const eatenPubkey = new PublicKey(eatenAddress);
  const [eaterStatePDA] = await findPlayerStatePDA(eaterPubkey);
  const [eatenStatePDA] = await findPlayerStatePDA(eatenPubkey);
  
  const data = serializeUpdatePlayerValueData(eaterPubkey, eatenPubkey, eatenValue);
  
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: publicKey, isSigner: true, isWritable: true }, // Authority (server)
      { pubkey: eaterStatePDA, isSigner: false, isWritable: true },
      { pubkey: eatenStatePDA, isSigner: false, isWritable: true },
      { pubkey: gamePDA, isSigner: false, isWritable: true },
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
  await fetch(`${GAME_SERVER_URL}/api/game/update-value`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eaterAddress,
      eatenAddress,
      eatenValue,
      transactionSignature: signature
    })
  });
  
  return { success: true, signature };
}

// Cash out - wypłata i wyjście z gry
export async function cashOut(wallet) {
  const { publicKey, signTransaction } = wallet;
  
  if (!publicKey) throw new Error('Wallet not connected');
  
  const [gamePDA] = await findGlobalGamePDA();
  const [playerStatePDA] = await findPlayerStatePDA(publicKey);
  
  // Pobierz aktualny stan gracza
  const playerStateAccount = await connection.getAccountInfo(playerStatePDA);
  if (!playerStateAccount) {
    throw new Error('Player state not found');
  }
  
  // Parsuj wartość gracza (uproszczone - w prawdziwej aplikacji użyj Borsh)
  // Zakładamy że current_value jest na pozycji 40-48 (po pubkey i stake_amount)
  const currentValue = playerStateAccount.data.readBigUInt64LE(40);
  const currentValueSol = Number(currentValue) / LAMPORTS_PER_SOL;
  
  console.log('Cashing out:', {
    currentValue: currentValue.toString(),
    currentValueSol
  });
  
  const data = serializeCashOutData();
  
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: publicKey, isSigner: true, isWritable: true },
      { pubkey: playerStatePDA, isSigner: false, isWritable: true },
      { pubkey: gamePDA, isSigner: false, isWritable: true },
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
  
  // Powiadom serwer
  await fetch(`${GAME_SERVER_URL}/api/game/cashout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerAddress: publicKey.toString(),
      transactionSignature: signature
    })
  });
  
  const platformFee = currentValueSol * 0.05;
  const playerReceived = currentValueSol * 0.95;
  
  return {
    success: true,
    signature,
    cashOutAmount: currentValueSol,
    platformFee,
    playerReceived
  };
}

// Połączenie z serwerem gry
export function connectToGameServer() {
  const socket = io(GAME_SERVER_URL, {
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    transports: ['websocket', 'polling']
  });
  
  return socket;
}