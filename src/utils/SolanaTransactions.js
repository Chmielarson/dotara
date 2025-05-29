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
import { Buffer } from 'buffer';

// Konfiguracja
const NETWORK = 'devnet';
const connection = new Connection(clusterApiUrl(NETWORK), 'confirmed');

// Hardcoded URL
const GAME_SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL || 'http://localhost:3001';
console.log('Using game server URL:', GAME_SERVER_URL);

// Program ID - ZAKTUALIZUJ PO DEPLOYU!
const PROGRAM_ID = new PublicKey('AaPU514d1iHKzdMyNtXhHgrf6g94qTTrXDyJqWpnSqfQ');
const PLATFORM_FEE_WALLET = new PublicKey('FEEfBE29dqRgC8qMv6f9YXTSNbX7LMN3Reo3UsYdoUd8');

console.log('Solana configuration loaded:', {
  NETWORK,
  PROGRAM_ID: PROGRAM_ID.toString(),
  GAME_SERVER_URL
});

// ========== SERIALIZACJA DANYCH ==========

function serializeInitializeGameData(serverAuthority) {
  const buffer = Buffer.alloc(1 + 32);
  buffer.writeUInt8(0, 0); // InitializeGame instruction
  serverAuthority.toBuffer().copy(buffer, 1);
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

// Pobierz adres serwera z API
async function getServerAuthority() {
  try {
    const response = await fetch(`${GAME_SERVER_URL}/api/game/status`);
    const data = await response.json();
    if (data.serverWalletAddress) {
      return new PublicKey(data.serverWalletAddress);
    }
  } catch (error) {
    console.error('Error fetching server authority:', error);
  }
  return null;
}

// ========== API FUNCTIONS ==========

// Sprawdź czy gracz już jest w grze
export async function checkPlayerState(wallet) {
  const { publicKey } = wallet;
  if (!publicKey) return null;
  
  const [playerStatePDA] = await findPlayerStatePDA(publicKey);
  
  try {
    const accountInfo = await connection.getAccountInfo(playerStatePDA);
    if (!accountInfo) {
      console.log('No player state account found');
      return null;
    }
    
    // Parsuj dane (uproszczone)
    // PlayerState structure:
    // pubkey: 32 bytes (0-31)
    // stake_amount: 8 bytes (32-39)
    // current_value: 8 bytes (40-47)
    // is_active: 1 byte (48)
    // joined_at: 8 bytes (49-56)
    // last_cashout: 8 bytes (57-64)
    // total_earned: 8 bytes (65-72)
    
    const isActive = accountInfo.data[48] === 1;
    const currentValue = accountInfo.data.readBigUInt64LE(40);
    const stakeAmount = accountInfo.data.readBigUInt64LE(32);
    
    console.log('Player state found:', {
      isActive,
      currentValue: Number(currentValue) / LAMPORTS_PER_SOL,
      stakeAmount: Number(stakeAmount) / LAMPORTS_PER_SOL
    });
    
    return {
      exists: true,
      isActive,
      currentValue: Number(currentValue) / LAMPORTS_PER_SOL,
      stakeAmount: Number(stakeAmount) / LAMPORTS_PER_SOL,
      currentValueLamports: Number(currentValue)
    };
  } catch (error) {
    console.error('Error checking player state:', error);
    return null;
  }
}

// Sprawdź stan globalnej gry
export async function checkGlobalGameState() {
  const [gamePDA] = await findGlobalGamePDA();
  
  try {
    const accountInfo = await connection.getAccountInfo(gamePDA);
    if (!accountInfo) {
      console.log('Global game account not found');
      return { initialized: false };
    }
    
    console.log('Global game account:', {
      owner: accountInfo.owner.toString(),
      lamports: accountInfo.lamports,
      dataLength: accountInfo.data.length,
      expectedProgramId: PROGRAM_ID.toString()
    });
    
    // Sprawdź czy konto należy do naszego programu
    if (!accountInfo.owner.equals(PROGRAM_ID)) {
      console.error('Game account owned by wrong program!');
      return { initialized: false, error: 'Wrong program owner' };
    }
    
    return { 
      initialized: true,
      lamports: accountInfo.lamports,
      dataLength: accountInfo.data.length
    };
  } catch (error) {
    console.error('Error checking game state:', error);
    return { initialized: false, error: error.message };
  }
}

// Inicjalizacja globalnej gry (tylko raz, przez admina)
export async function initializeGlobalGame(wallet, serverAuthority = null) {
  const { publicKey, signTransaction } = wallet;
  
  if (!publicKey) throw new Error('Wallet not connected');
  
  // Jeśli nie podano server authority, spróbuj pobrać z API
  if (!serverAuthority) {
    serverAuthority = await getServerAuthority();
    if (!serverAuthority) {
      throw new Error('Server authority not found. Make sure server is running.');
    }
  }
  
  const [gamePDA] = await findGlobalGamePDA();
  
  // Sprawdź czy gra już istnieje
  const accountInfo = await connection.getAccountInfo(gamePDA);
  if (accountInfo) {
    console.log('Global game already initialized');
    return { alreadyInitialized: true };
  }
  
  const data = serializeInitializeGameData(serverAuthority);
  
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
  
  console.log('Global game initialized with server authority:', serverAuthority.toString());
  
  return { success: true, signature };
}

// Dołączanie do globalnej gry
export async function joinGlobalGame(stakeAmount, wallet) {
  const { publicKey, signTransaction } = wallet;
  
  if (!publicKey) throw new Error('Wallet not connected');
  
  // Sprawdź stan gracza przed próbą dołączenia
  const playerState = await checkPlayerState(wallet);
  
  // Gracz może dołączyć jeśli:
  // 1. Nie ma konta na blockchain (nowy gracz)
  // 2. Ma konto ale nie jest aktywny (został zjedzony)
  // 3. Ma konto, jest aktywny ale wartość = 0 (respawn po śmierci)
  
  if (playerState?.isActive && playerState.currentValueLamports > 0) {
    throw new Error('You are already active in the game. Please cash out first.');
  }
  
  const [gamePDA] = await findGlobalGamePDA();
  const [playerStatePDA] = await findPlayerStatePDA(publicKey);
  
  console.log('Joining global game:', {
    stakeAmount,
    gamePDA: gamePDA.toString(),
    playerStatePDA: playerStatePDA.toString(),
    existingPlayer: playerState?.exists,
    isActive: playerState?.isActive,
    currentValue: playerState?.currentValueLamports
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
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to register with game server');
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
  
  // Pobierz dane z localStorage (zawierają aktualną wartość gracza z serwera)
  const pendingCashOutData = localStorage.getItem('dotara_io_pending_cashout');
  if (!pendingCashOutData) {
    throw new Error('No pending cash out data found');
  }
  
  const pendingCashOut = JSON.parse(pendingCashOutData);
  const currentValueLamports = pendingCashOut.amount || 0;
  const currentValueSol = currentValueLamports / 1000000000;
  
  if (currentValueLamports === 0) {
    throw new Error('You have no SOL to cash out');
  }
  
  console.log('Cashing out with server value:', {
    currentValueLamports,
    currentValueSol,
    pendingCashOut
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
  try {
    const response = await fetch(`${GAME_SERVER_URL}/api/game/cashout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerAddress: publicKey.toString(),
        transactionSignature: signature
      })
    });
    
    if (!response.ok) {
      console.error('Server notification failed, but transaction succeeded');
    }
  } catch (error) {
    console.error('Failed to notify server:', error);
  }
  
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

// Export connection dla innych komponentów jeśli potrzebują
export { connection, PROGRAM_ID };