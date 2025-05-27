// src/App.js
import React, { useState, useEffect } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import JoinGame from './components/JoinGame';  // <- Sprawdź to
import Game from './components/Game';          // <- I to
import './App.css';
import '@solana/wallet-adapter-react-ui/styles.css';
import io from 'socket.io-client';

const network = WalletAdapterNetwork.Devnet;
const endpoint = clusterApiUrl(network);
const wallets = [new PhantomWalletAdapter()];

function AppContent() {
  const wallet = useWallet();
  const { publicKey } = wallet;
  
  const [currentView, setCurrentView] = useState('join'); // 'join' lub 'game'
  const [socket, setSocket] = useState(null);
  const [playerStake, setPlayerStake] = useState(0);
  const [playerNickname, setPlayerNickname] = useState('');
  
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
    const savedGameState = localStorage.getItem('dotara_io_game_state');
    if (savedGameState && publicKey) {
      const { playerAddress, stake, nickname } = JSON.parse(savedGameState);
      
      if (playerAddress === publicKey.toString()) {
        setPlayerStake(stake);
        setPlayerNickname(nickname);
        setCurrentView('game');
      } else {
        localStorage.removeItem('dotara_io_game_state');
      }
    }
  }, [publicKey]);
  
  // Save game state
  useEffect(() => {
    if (currentView === 'game' && publicKey && playerStake > 0) {
      localStorage.setItem('dotara_io_game_state', JSON.stringify({
        playerAddress: publicKey.toString(),
        stake: playerStake,
        nickname: playerNickname
      }));
    }
  }, [currentView, publicKey, playerStake, playerNickname]);
  
  const handleJoinGame = (stake, nickname) => {
    setPlayerStake(stake);
    setPlayerNickname(nickname);
    setCurrentView('game');
  };
  
  const handleLeaveGame = () => {
    setCurrentView('join');
    setPlayerStake(0);
    setPlayerNickname('');
    localStorage.removeItem('dotara_io_game_state');
  };
  
  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
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
        {currentView === 'join' && (
          <JoinGame 
            onJoinGame={handleJoinGame}
            socket={socket}
          />
        )}
        
        {currentView === 'game' && (
          <Game 
            initialStake={playerStake}
            nickname={playerNickname}
            onLeaveGame={handleLeaveGame}
            socket={socket}
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