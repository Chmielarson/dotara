// src/App.js
import React, { useState, useEffect } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import Lobby from './components/Lobby';
import CreateGame from './components/CreateGame';
import Game from './components/Game';
import { joinRoom, startGame } from './utils/SolanaTransactions';
import './App.css';
import '@solana/wallet-adapter-react-ui/styles.css';

const network = WalletAdapterNetwork.Devnet;
const endpoint = clusterApiUrl(network);
const wallets = [new PhantomWalletAdapter()];

function AppContent() {
  const wallet = useWallet();
  const { publicKey } = wallet;
  
  const [currentView, setCurrentView] = useState('lobby');
  const [currentRoomId, setCurrentRoomId] = useState(null);
  const [currentRoomInfo, setCurrentRoomInfo] = useState(null);
  
  // Sprawdź czy użytkownik był w grze przed odświeżeniem
  useEffect(() => {
    const savedRoom = localStorage.getItem('solana_io_current_room');
    if (savedRoom) {
      const { roomId, roomInfo } = JSON.parse(savedRoom);
      if (roomInfo.gameStarted) {
        setCurrentRoomId(roomId);
        setCurrentRoomInfo(roomInfo);
        setCurrentView('game');
      }
    }
  }, []);
  
  // Zapisz stan gry
  useEffect(() => {
    if (currentRoomId && currentRoomInfo && currentView === 'game') {
      localStorage.setItem('solana_io_current_room', JSON.stringify({
        roomId: currentRoomId,
        roomInfo: currentRoomInfo
      }));
    } else {
      localStorage.removeItem('solana_io_current_room');
    }
  }, [currentRoomId, currentRoomInfo, currentView]);
  
  const handleJoinRoom = async (roomId) => {
    if (!publicKey) {
      alert('Połącz portfel, aby dołączyć do gry');
      return;
    }
    
    try {
      // Pobierz informacje o pokoju
      const response = await fetch(`${process.env.REACT_APP_GAME_SERVER_URL || 'http://localhost:3001'}/api/rooms/${roomId}`);
      const roomInfo = await response.json();
      
      setCurrentRoomId(roomId);
      setCurrentRoomInfo(roomInfo);
      
      // Sprawdź czy gracz jest już w pokoju
      if (roomInfo.players.includes(publicKey.toString())) {
        // Gracz już jest w pokoju
        if (roomInfo.gameStarted) {
          setCurrentView('game');
        } else {
          setCurrentView('waiting');
        }
      } else {
        // Dołącz do pokoju
        await joinRoom(roomId, roomInfo.entryFee, wallet);
        
        // Odśwież informacje o pokoju
        const updatedResponse = await fetch(`${process.env.REACT_APP_GAME_SERVER_URL || 'http://localhost:3001'}/api/rooms/${roomId}`);
        const updatedRoomInfo = await updatedResponse.json();
        setCurrentRoomInfo(updatedRoomInfo);
        
        setCurrentView('waiting');
      }
    } catch (error) {
      console.error('Error joining room:', error);
      alert(`Błąd dołączania do pokoju: ${error.message}`);
    }
  };
  
  const handleCreateRoom = () => {
    if (!publicKey) {
      alert('Połącz portfel, aby stworzyć pokój');
      return;
    }
    setCurrentView('create');
  };
  
  const handleRoomCreated = async (roomId) => {
    try {
      // Pobierz informacje o utworzonym pokoju
      const response = await fetch(`${process.env.REACT_APP_GAME_SERVER_URL || 'http://localhost:3001'}/api/rooms/${roomId}`);
      const roomInfo = await response.json();
      
      setCurrentRoomId(roomId);
      setCurrentRoomInfo(roomInfo);
      setCurrentView('waiting');
    } catch (error) {
      console.error('Error fetching room info:', error);
    }
  };
  
  const handleStartGame = async () => {
    if (!currentRoomId || !currentRoomInfo) return;
    
    try {
      await startGame(currentRoomId, wallet);
      
      // Odśwież informacje o pokoju
      const response = await fetch(`${process.env.REACT_APP_GAME_SERVER_URL || 'http://localhost:3001'}/api/rooms/${currentRoomId}`);
      const updatedRoomInfo = await response.json();
      setCurrentRoomInfo(updatedRoomInfo);
      
      setCurrentView('game');
    } catch (error) {
      console.error('Error starting game:', error);
      alert(`Błąd rozpoczynania gry: ${error.message}`);
    }
  };
  
  const handleBack = () => {
    setCurrentView('lobby');
    setCurrentRoomId(null);
    setCurrentRoomInfo(null);
  };
  
  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <h1>Solana.io</h1>
          <p>Blockchain Battle Royale</p>
        </div>
        <div className="wallet-section">
          <WalletMultiButton />
          {publicKey && (
            <div className="wallet-info">
              <span className="balance">Połączono</span>
            </div>
          )}
        </div>
      </header>
      
      <main className="app-main">
        {currentView === 'lobby' && (
          <Lobby 
            onJoinRoom={handleJoinRoom}
            onCreateRoom={handleCreateRoom}
          />
        )}
        
        {currentView === 'create' && (
          <CreateGame 
            onBack={handleBack}
            onRoomCreated={handleRoomCreated}
          />
        )}
        
        {currentView === 'waiting' && currentRoomInfo && (
          <div className="waiting-room">
            <h2>Oczekiwanie na graczy</h2>
            <div className="room-details">
              <p>ID Pokoju: {currentRoomId}</p>
              <p>Gracze: {currentRoomInfo.players.length}/{currentRoomInfo.maxPlayers}</p>
              <p>Wpisowe: {currentRoomInfo.entryFee} SOL</p>
              <p>Pula: {currentRoomInfo.entryFee * currentRoomInfo.players.length} SOL</p>
            </div>
            
            <div className="players-waiting">
              <h3>Gracze w pokoju:</h3>
              {currentRoomInfo.players.map((player, index) => (
                <div key={player} className="player-waiting">
                  {player.substring(0, 8)}...{player.substring(player.length - 8)}
                  {index === 0 && ' 👑'}
                </div>
              ))}
            </div>
            
            {currentRoomInfo.players.length >= 2 && 
             currentRoomInfo.players[0] === publicKey?.toString() && (
              <button className="start-game-btn" onClick={handleStartGame}>
                Rozpocznij grę
              </button>
            )}
            
            <button className="back-btn" onClick={handleBack}>
              Wróć do lobby
            </button>
          </div>
        )}
        
        {currentView === 'game' && currentRoomId && currentRoomInfo && (
          <Game 
            roomId={currentRoomId}
            roomInfo={currentRoomInfo}
            onBack={handleBack}
          />
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <AppContent />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}