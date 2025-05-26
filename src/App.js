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
import { joinRoom, startGame, getRoomsUpdates, cancelRoom } from './utils/SolanaTransactions';
import './App.css';
import '@solana/wallet-adapter-react-ui/styles.css';
import io from 'socket.io-client';

// Import logo - zmień ścieżkę jeśli logo jest w innym miejscu
// Jeśli logo jest w public: '/logo.png'
// Jeśli logo jest w src/assets: import logo from './assets/logo.png';

const network = WalletAdapterNetwork.Devnet;
const endpoint = clusterApiUrl(network);
const wallets = [new PhantomWalletAdapter()];

function AppContent() {
  const wallet = useWallet();
  const { publicKey } = wallet;
  
  const [currentView, setCurrentView] = useState('lobby');
  const [currentRoomId, setCurrentRoomId] = useState(null);
  const [currentRoomInfo, setCurrentRoomInfo] = useState(null);
  const [socket, setSocket] = useState(null);
  
  // Initialize socket.io
  useEffect(() => {
    const GAME_SERVER_URL = process.env.REACT_APP_GAME_SERVER_URL || 'http://localhost:3001';
    const newSocket = io(GAME_SERVER_URL, {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
    
    setSocket(newSocket);
    
    return () => {
      newSocket.disconnect();
    };
  }, []);
  
  // Check if user was in game before refresh
  useEffect(() => {
    const savedRoom = localStorage.getItem('dotara_io_current_room');
    if (savedRoom && publicKey) {
      const { roomId, roomInfo } = JSON.parse(savedRoom);
      
      // Check if user is in room
      if (roomInfo.players.includes(publicKey.toString())) {
        setCurrentRoomId(roomId);
        setCurrentRoomInfo(roomInfo);
        
        if (roomInfo.gameStarted) {
          setCurrentView('game');
        } else {
          setCurrentView('waiting');
        }
      } else {
        // User not in room, clear localStorage
        localStorage.removeItem('dotara_io_current_room');
      }
    }
  }, [publicKey]);
  
  // Save game state
  useEffect(() => {
    if (currentRoomId && currentRoomInfo && (currentView === 'game' || currentView === 'waiting')) {
      localStorage.setItem('dotara_io_current_room', JSON.stringify({
        roomId: currentRoomId,
        roomInfo: currentRoomInfo
      }));
    } else {
      localStorage.removeItem('dotara_io_current_room');
    }
  }, [currentRoomId, currentRoomInfo, currentView]);
  
  // Listen for room updates
  useEffect(() => {
    if (!socket || !currentRoomId || currentView !== 'waiting') return;
    
    const handleRoomsUpdate = (rooms) => {
      const updatedRoom = rooms.find(r => r.id === currentRoomId);
      if (updatedRoom) {
        setCurrentRoomInfo({
          ...updatedRoom,
          currentPlayers: updatedRoom.players.length
        });
      }
    };
    
    const handleGameStarted = (data) => {
      if (data.roomId === currentRoomId) {
        // Game started
        setCurrentView('game');
      }
    };
    
    const handleRoomCancelled = (data) => {
      if (data.roomId === currentRoomId) {
        alert('Room has been cancelled by the creator');
        handleBack();
      }
    };
    
    // Listen for updates
    socket.on('rooms_update', handleRoomsUpdate);
    socket.on('game_started', handleGameStarted);
    socket.on('room_cancelled', handleRoomCancelled);
    
    // Request updates
    socket.emit('get_rooms');
    
    return () => {
      socket.off('rooms_update', handleRoomsUpdate);
      socket.off('game_started', handleGameStarted);
      socket.off('room_cancelled', handleRoomCancelled);
    };
  }, [socket, currentRoomId, currentView]);
  
  // Periodic room info refresh
  useEffect(() => {
    if (!currentRoomId || currentView !== 'waiting') return;
    
    const fetchRoomInfo = async () => {
      try {
        const response = await fetch(`${process.env.REACT_APP_GAME_SERVER_URL || 'http://localhost:3001'}/api/rooms/${currentRoomId}`);
        if (response.ok) {
          const roomInfo = await response.json();
          setCurrentRoomInfo({
            ...roomInfo,
            currentPlayers: roomInfo.players.length
          });
          
          // If game started, go to game view
          if (roomInfo.gameStarted) {
            setCurrentView('game');
          }
        }
      } catch (error) {
        console.error('Error fetching room info:', error);
      }
    };
    
    // Fetch immediately
    fetchRoomInfo();
    
    // Then every 2 seconds
    const interval = setInterval(fetchRoomInfo, 2000);
    
    return () => clearInterval(interval);
  }, [currentRoomId, currentView]);
  
  const handleJoinRoom = async (roomId) => {
    if (!publicKey) {
      alert('Connect wallet to join the game');
      return;
    }
    
    try {
      // Get room info
      const response = await fetch(`${process.env.REACT_APP_GAME_SERVER_URL || 'http://localhost:3001'}/api/rooms/${roomId}`);
      const roomInfo = await response.json();
      
      setCurrentRoomId(roomId);
      setCurrentRoomInfo({
        ...roomInfo,
        currentPlayers: roomInfo.players.length
      });
      
      // Check if player is already in room
      if (roomInfo.players.includes(publicKey.toString())) {
        // Player already in room
        if (roomInfo.gameStarted) {
          setCurrentView('game');
        } else {
          setCurrentView('waiting');
        }
      } else {
        // Join room
        await joinRoom(roomId, roomInfo.entryFee, wallet);
        
        // Refresh room info
        const updatedResponse = await fetch(`${process.env.REACT_APP_GAME_SERVER_URL || 'http://localhost:3001'}/api/rooms/${roomId}`);
        const updatedRoomInfo = await updatedResponse.json();
        setCurrentRoomInfo({
          ...updatedRoomInfo,
          currentPlayers: updatedRoomInfo.players.length
        });
        
        setCurrentView('waiting');
      }
    } catch (error) {
      console.error('Error joining room:', error);
      alert(`Error joining room: ${error.message}`);
    }
  };
  
  const handleCreateRoom = () => {
    if (!publicKey) {
      alert('Connect wallet to create a room');
      return;
    }
    setCurrentView('create');
  };
  
  const handleRoomCreated = async (roomId) => {
    try {
      // Get created room info
      const response = await fetch(`${process.env.REACT_APP_GAME_SERVER_URL || 'http://localhost:3001'}/api/rooms/${roomId}`);
      const roomInfo = await response.json();
      
      setCurrentRoomId(roomId);
      setCurrentRoomInfo({
        ...roomInfo,
        currentPlayers: roomInfo.players.length
      });
      setCurrentView('waiting');
    } catch (error) {
      console.error('Error fetching room info:', error);
    }
  };
  
  const handleStartGame = async () => {
    if (!currentRoomId || !currentRoomInfo) return;
    
    try {
      await startGame(currentRoomId, wallet);
      
      // Don't wait for refresh, go straight to game
      setCurrentView('game');
    } catch (error) {
      console.error('Error starting game:', error);
      alert(`Error starting game: ${error.message}`);
    }
  };
  
  const handleCancelRoom = async () => {
    if (!currentRoomId || !currentRoomInfo) return;
    
    // Sprawdź czy użytkownik jest twórcą pokoju
    if (currentRoomInfo.players[0] !== publicKey.toString()) {
      alert('Only room creator can cancel the room');
      return;
    }
    
    // Sprawdź czy gra już się rozpoczęła
    if (currentRoomInfo.gameStarted) {
      alert('Cannot cancel room - game already started');
      return;
    }
    
    try {
      const confirmCancel = window.confirm(
        'Are you sure you want to cancel this room?\n' +
        'All players will be refunded their entry fees.'
      );
      
      if (!confirmCancel) return;
      
      // Wywołaj funkcję anulowania pokoju
      await cancelRoom(currentRoomId, wallet);
      
      alert('Room cancelled successfully. Funds have been returned.');
      
      // Wróć do lobby
      handleBack();
    } catch (error) {
      console.error('Error cancelling room:', error);
      alert(`Error cancelling room: ${error.message}`);
    }
  };
  
  const handleBack = () => {
    setCurrentView('lobby');
    setCurrentRoomId(null);
    setCurrentRoomInfo(null);
    localStorage.removeItem('dotara_io_current_room');
  };
  
  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          {/* Tutaj tylko logo bez napisu Blockchain Battle Royale */}
          <img src="/logo.png" alt="Dotara.io" className="logo" />
        </div>
        <div className="wallet-section">
          <WalletMultiButton />
          {publicKey && (
            <div className="wallet-info">
              <span className="balance">Connected</span>
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
            <h2>Waiting for players</h2>
            <div className="room-details">
              <p>Room ID: {currentRoomId}</p>
              <p>Players: {currentRoomInfo.currentPlayers || currentRoomInfo.players.length}/{currentRoomInfo.maxPlayers}</p>
              <p>Entry fee: {currentRoomInfo.entryFee} SOL</p>
              <p>Prize pool: {currentRoomInfo.entryFee * (currentRoomInfo.currentPlayers || currentRoomInfo.players.length)} SOL</p>
            </div>
            
            <div className="players-waiting">
              <h3>Players in room:</h3>
              {currentRoomInfo.players.map((player, index) => (
                <div key={player} className="player-waiting">
                  {player.substring(0, 8)}...{player.substring(player.length - 8)}
                  {index === 0 && ' 👑'}
                  {player === publicKey?.toString() && ' (You)'}
                </div>
              ))}
            </div>
            
            {currentRoomInfo.players.length >= 2 && 
             currentRoomInfo.players[0] === publicKey?.toString() && (
              <button className="start-game-btn" onClick={handleStartGame}>
                Start game
              </button>
            )}
            
            {/* Przycisk anulowania - tylko dla twórcy pokoju gdy jest sam */}
            {currentRoomInfo.players.length === 1 && 
             currentRoomInfo.players[0] === publicKey?.toString() && (
              <button className="cancel-room-btn" onClick={handleCancelRoom}>
                Cancel room
              </button>
            )}
            
            <button className="back-btn" onClick={handleBack}>
              Back to lobby
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