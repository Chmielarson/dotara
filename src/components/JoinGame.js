// src/components/JoinGame.js
import React, { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { joinGlobalGame } from '../utils/SolanaTransactions';
import Chat from './Chat';
import './JoinGame.css';

export default function JoinGame({ onJoinGame, socket }) {
  const wallet = useWallet();
  const { publicKey } = wallet;
  
  const [nickname, setNickname] = useState('');
  const [stakeAmount, setStakeAmount] = useState(0.1);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState('');
  const [gameStats, setGameStats] = useState(null);
  
  // Fetch game stats
  useEffect(() => {
    const fetchGameStats = async () => {
      try {
        const response = await fetch(`${process.env.REACT_APP_GAME_SERVER_URL || 'http://localhost:3001'}/api/game/status`);
        const data = await response.json();
        setGameStats(data);
      } catch (error) {
        console.error('Error fetching game stats:', error);
      }
    };
    
    fetchGameStats();
    const interval = setInterval(fetchGameStats, 5000); // Update every 5 seconds
    
    return () => clearInterval(interval);
  }, []);
  
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
  
  return (
    <div className="join-game-container">
      <div className="join-content">
        <div className="join-left">
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
        
        <div className="join-right">
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
        </div>
      </div>
      
      {publicKey && socket && (
        <Chat socket={socket} playerAddress={publicKey.toString()} />
      )}
    </div>
  );
}