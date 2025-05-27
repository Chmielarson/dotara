// src/components/JoinGame.js
import React, { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { joinGlobalGame, initializeGlobalGame, checkGlobalGameState } from '../utils/SolanaTransactions';
import './JoinGame.css';

export default function JoinGame({ onJoinGame, socket }) {
  const wallet = useWallet();
  const { publicKey } = wallet;
  
  const [nickname, setNickname] = useState('');
  const [stakeAmount, setStakeAmount] = useState(0.1);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState('');
  const [gameStats, setGameStats] = useState(null);
  const [gameInitialized, setGameInitialized] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [checkingGame, setCheckingGame] = useState(true);
  
  // Chat state
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  
  // Check if global game is initialized
  useEffect(() => {
    // Disable scrolling on mount
    const originalOverflow = document.body.style.overflow;
    const originalPosition = document.body.style.position;
    const originalWidth = document.body.style.width;
    const originalHeight = document.body.style.height;
    
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.height = '100vh';
    
    const checkGame = async () => {
      try {
        setCheckingGame(true);
        const gameState = await checkGlobalGameState();
        setGameInitialized(gameState.initialized);
        console.log('Global game state:', gameState);
      } catch (error) {
        console.error('Error checking game state:', error);
        setGameInitialized(false);
      } finally {
        setCheckingGame(false);
      }
    };
    
    checkGame();
    
    // Cleanup - restore scrolling when component unmounts
    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.position = originalPosition;
      document.body.style.width = originalWidth;
      document.body.style.height = originalHeight;
    };
  }, []);
  
  // Fetch game stats
  useEffect(() => {
    const fetchGameStats = async () => {
      try {
        const GAME_SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL || 'http://localhost:3001';
        const response = await fetch(`${GAME_SERVER_URL}/api/game/status`);
        const data = await response.json();
        setGameStats(data);
      } catch (error) {
        console.error('Error fetching game stats:', error);
      }
    };
    
    if (gameInitialized) {
      fetchGameStats();
      const interval = setInterval(fetchGameStats, 5000); // Update every 5 seconds
      return () => clearInterval(interval);
    }
  }, [gameInitialized]);
  
  // Chat connection
  useEffect(() => {
    if (!socket || !publicKey) return;
    
    // Join lobby
    socket.emit('join_lobby', { playerAddress: publicKey.toString() });
    setIsConnected(true);
    
    // Listen for chat history
    socket.on('chat_history', (history) => {
      setMessages(history);
    });
    
    // Listen for new messages
    socket.on('new_chat_message', (message) => {
      setMessages(prev => [...prev, message]);
    });
    
    return () => {
      socket.emit('leave_lobby');
      socket.off('chat_history');
      socket.off('new_chat_message');
      setIsConnected(false);
    };
  }, [socket, publicKey]);
  
  const sendMessage = (e) => {
    e.preventDefault();
    
    if (!inputMessage.trim() || !socket || !isConnected || !publicKey) return;
    
    socket.emit('chat_message', {
      playerAddress: publicKey.toString(),
      message: inputMessage
    });
    
    setInputMessage('');
  };
  
  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };
  
  const formatAddress = (address) => {
    return `${address.substring(0, 4)}...${address.substring(address.length - 4)}`;
  };
  
  const handleInitializeGame = async () => {
    if (!publicKey) {
      setError('Please connect your wallet');
      return;
    }
    
    try {
      setIsInitializing(true);
      setError('');
      
      const result = await initializeGlobalGame(wallet);
      
      if (result.alreadyInitialized) {
        setError('Game is already initialized');
        setGameInitialized(true);
      } else {
        alert('Global game initialized successfully!');
        setGameInitialized(true);
      }
    } catch (error) {
      console.error('Error initializing game:', error);
      setError(`Failed to initialize: ${error.message}`);
    } finally {
      setIsInitializing(false);
    }
  };
  
  const handleJoin = async () => {
    if (!publicKey) {
      setError('Please connect your wallet');
      return;
    }
    
    if (!nickname.trim()) {
      setError('Please enter a nickname');
      return;
    }
    
    if (stakeAmount < 0.01 || stakeAmount > 10) {
      setError('Stake must be between 0.01 and 10 SOL');
      return;
    }
    
    try {
      setIsJoining(true);
      setError('');
      
      // Execute blockchain transaction
      const result = await joinGlobalGame(stakeAmount, wallet);
      
      // If successful, proceed to game
      onJoinGame(result.stakeInLamports, nickname.trim());
    } catch (error) {
      console.error('Error joining game:', error);
      setError(`Failed to join: ${error.message}`);
    } finally {
      setIsJoining(false);
    }
  };
  
  // Show initialization screen if game not initialized
  if (!gameInitialized && !checkingGame) {
    return (
      <div className="join-game-container">
        <div className="join-content">
          <div className="join-box" style={{ maxWidth: '600px', margin: '0 auto' }}>
            <h1>Initialize Global Game</h1>
            <p className="subtitle">The global game needs to be initialized first</p>
            
            <div style={{ 
              background: '#FEF5E7', 
              border: '3px solid #F39C12', 
              borderRadius: '15px', 
              padding: '20px',
              marginBottom: '30px'
            }}>
              <p style={{ margin: 0, color: '#34495E', fontWeight: 700 }}>
                This is a one-time setup that creates the global game account on the blockchain. 
                After initialization, all players can join and play in the same persistent world.
              </p>
            </div>
            
            {error && (
              <div className="error-message" style={{ marginBottom: '20px' }}>
                {error}
              </div>
            )}
            
            <button 
              className="join-button"
              onClick={handleInitializeGame}
              disabled={isInitializing || !publicKey}
              style={{ marginBottom: '20px' }}
            >
              {isInitializing ? 'Initializing...' : 
               !publicKey ? 'Connect Wallet First' : 
               'Initialize Global Game'}
            </button>
            
            <div style={{ textAlign: 'center', color: '#7F8C8D', fontSize: '14px' }}>
              <p>Note: Only needs to be done once per program deployment</p>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  // Show loading while checking
  if (checkingGame) {
    return (
      <div className="join-game-container">
        <div className="join-content">
          <div className="join-box" style={{ textAlign: 'center' }}>
            <h2>Checking game status...</h2>
            <div className="spinner" style={{ margin: '20px auto' }}></div>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="join-game-container">
      <div className="join-content-wrapper">
        <div className="join-left">
          {gameStats && (
            <div className="game-stats">
              <h3>Live Game Stats</h3>
              <div className="stat-item">
                <span className="label">Active Players</span>
                <span className="value">{gameStats.playerCount}</span>
              </div>
              <div className="stat-item">
                <span className="label">Total SOL in Game</span>
                <span className="value">{gameStats.totalSolDisplay} SOL</span>
              </div>
              <div className="stat-item">
                <span className="label">Map Size</span>
                <span className="value">{gameStats.mapSize}x{gameStats.mapSize}</span>
              </div>
              
              {gameStats.zoneStats && (
                <div className="zone-stats">
                  <h4>Players per Zone</h4>
                  <div className="zone-stat-item">
                    <span>🥉 Bronze:</span>
                    <span>{gameStats.zoneStats[1]?.playerCount || 0}</span>
                  </div>
                  <div className="zone-stat-item">
                    <span>🥈 Silver:</span>
                    <span>{gameStats.zoneStats[2]?.playerCount || 0}</span>
                  </div>
                  <div className="zone-stat-item">
                    <span>🥇 Gold:</span>
                    <span>{gameStats.zoneStats[3]?.playerCount || 0}</span>
                  </div>
                  <div className="zone-stat-item">
                    <span>💎 Diamond:</span>
                    <span>{gameStats.zoneStats[4]?.playerCount || 0}</span>
                  </div>
                </div>
              )}
              
              {gameStats.leaderboard && gameStats.leaderboard.length > 0 && (
                <div className="mini-leaderboard">
                  <h4>Top Players</h4>
                  {gameStats.leaderboard.slice(0, 5).map((player) => (
                    <div key={player.address} className="leader-item">
                      <span className="rank">#{player.rank}</span>
                      <span className="name">{player.nickname}</span>
                      <span className="sol">{player.solDisplay} SOL</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          
          <div className="how-to-play">
            <h3>How to Play</h3>
            <ul>
              <li>
                <span className="icon">🎮</span>
                <div>
                  <strong>Move</strong> with your mouse
                </div>
              </li>
              <li>
                <span className="icon">🍕</span>
                <div>
                  <strong>Eat food</strong> to grow bigger (adds mass only)
                </div>
              </li>
              <li>
                <span className="icon">💰</span>
                <div>
                  <strong>Eat players</strong> to steal their SOL + gain mass
                </div>
              </li>
              <li>
                <span className="icon">🚀</span>
                <div>
                  <strong>Space</strong> to boost (costs 10% mass)
                </div>
              </li>
              <li>
                <span className="icon">💸</span>
                <div>
                  <strong>Cash out</strong> anytime to claim your SOL
                </div>
              </li>
            </ul>
          </div>
        </div>
        
        <div className="join-middle">
          <div className="join-box">
            <h1>Join the Global Arena</h1>
            <p className="subtitle">Eat, grow, and earn SOL!</p>
            
            <div className="join-form">
              <div className="form-group">
                <label>
                  Nickname
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="Enter your nickname..."
                    maxLength={20}
                    disabled={isJoining}
                  />
                </label>
              </div>
              
              <div className="form-group">
                <label>
                  Buy-in Amount (SOL)
                  <input
                    type="number"
                    value={stakeAmount}
                    onChange={(e) => setStakeAmount(parseFloat(e.target.value) || 0)}
                    min="0.01"
                    max="10"
                    step="0.01"
                    disabled={isJoining}
                  />
                  <span className="hint">Min: 0.01 SOL, Max: 10 SOL</span>
                </label>
              </div>
              
              <div className="stake-info">
                <div className="info-item">
                  <span>Your buy-in:</span>
                  <span className="value">{stakeAmount} SOL</span>
                </div>
                <div className="info-item">
                  <span>Platform fee (5%):</span>
                  <span className="value">{(stakeAmount * 0.05).toFixed(3)} SOL</span>
                </div>
                <div className="info-item highlight">
                  <span>You start with:</span>
                  <span className="value">{stakeAmount} SOL</span>
                </div>
              </div>
              
              {error && (
                <div className="error-message">
                  {error}
                </div>
              )}
              
              <button 
                className="join-button"
                onClick={handleJoin}
                disabled={isJoining || !publicKey}
              >
                {isJoining ? 'Joining...' : 
                 !publicKey ? 'Connect Wallet' : 
                 'Join Game'}
              </button>
            </div>
          </div>
        </div>
        
        <div className="join-right">
          <div className="static-chat-container">
            <div className="chat-header">
              <h3>Global Chat</h3>
              <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
                {isConnected ? '● Online' : '○ Offline'}
              </div>
            </div>
            
            <div className="chat-messages">
              {messages.length === 0 ? (
                <div className="no-messages">
                  <p>No messages yet. Say hello!</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div 
                    key={msg.id} 
                    className={`chat-message ${msg.playerAddress === publicKey?.toString() ? 'own-message' : ''}`}
                  >
                    <div className="message-header">
                      <span className="message-author">
                        {formatAddress(msg.playerAddress)}
                        {msg.playerAddress === publicKey?.toString() && ' (You)'}
                      </span>
                      <span className="message-time">{formatTime(msg.timestamp)}</span>
                    </div>
                    <div className="message-content">{msg.message}</div>
                  </div>
                ))
              )}
            </div>
            
            <form className="chat-input-form" onSubmit={sendMessage}>
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder={isConnected ? "Type a message..." : "Connect wallet to chat"}
                maxLength={200}
                disabled={!isConnected || !publicKey}
                className="chat-input"
              />
              <button 
                type="submit" 
                disabled={!isConnected || !inputMessage.trim() || !publicKey}
                className="chat-send-btn"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}