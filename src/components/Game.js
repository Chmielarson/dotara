// src/components/Game.js
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import Canvas from './Canvas';
import { cashOut } from '../utils/SolanaTransactions';
import './Game.css';

export default function Game({ initialStake, nickname, onLeaveGame, socket }) {
  const wallet = useWallet();
  const { publicKey } = wallet;
  
  const [gameState, setGameState] = useState(null);
  const [playerView, setPlayerView] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isPlayerDead, setIsPlayerDead] = useState(false);
  const [isCashingOut, setIsCashingOut] = useState(false);
  const [showCashOutModal, setShowCashOutModal] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Connecting...');
  const [deathReason, setDeathReason] = useState('');
  
  const canvasRef = useRef(null);
  const inputRef = useRef({
    mouseX: 0,
    mouseY: 0,
    split: false,
    eject: false
  });
  
  // Zapobiegaj przewijaniu strony podczas gry
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    const originalPosition = document.body.style.position;
    const originalHeight = document.body.style.height;
    
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.height = '100vh';
    document.body.style.width = '100vw';
    
    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.position = originalPosition;
      document.body.style.height = originalHeight;
      document.body.style.width = '';
    };
  }, []);
  
  // Connect to game
  useEffect(() => {
    if (!socket || !publicKey) {
      console.log('Missing socket or publicKey:', { socket: !!socket, publicKey: !!publicKey });
      return;
    }
    
    console.log('Setting up game connection...');
    setConnectionStatus('Joining game...');
    
    // Join game immediately
    console.log('Emitting join_game:', {
      playerAddress: publicKey.toString(),
      nickname,
      initialStake
    });
    
    socket.emit('join_game', {
      playerAddress: publicKey.toString(),
      nickname: nickname || `Player ${publicKey.toString().substring(0, 6)}`,
      initialStake: initialStake
    });
    
    // Set up event listeners
    const handleJoinedGame = (data) => {
      console.log('Received joined_game:', data);
      if (data.success) {
        setIsConnected(true);
        setConnectionStatus('Connected to game');
      }
    };
    
    const handleGameState = (state) => {
      console.log('Received game_state:', {
        playerCount: state.playerCount,
        foodCount: state.foodCount,
        mapSize: state.mapSize
      });
      setGameState(state);
    };
    
    const handlePlayerView = (view) => {
      if (!view) {
        console.error('Received null player view');
        return;
      }
      
      console.log('Received player_view:', {
        hasPlayer: !!view.player,
        playerAlive: view.player?.isAlive,
        playerPos: view.player ? `${Math.floor(view.player.x)}, ${Math.floor(view.player.y)}` : 'N/A',
        playersCount: view.players?.length || 0,
        foodCount: view.food?.length || 0
      });
      
      setPlayerView(view);
      setConnectionStatus('In game');
      
      // Initialize mouse position to player position
      if (view.player && inputRef.current.mouseX === 0 && inputRef.current.mouseY === 0) {
        inputRef.current.mouseX = view.player.x;
        inputRef.current.mouseY = view.player.y;
      }
    };
    
    const handlePlayerEliminated = (data) => {
      console.log('Player eliminated:', data);
      if (data.playerAddress === publicKey.toString()) {
        setIsPlayerDead(true);
        setDeathReason(data.reason || 'You were eaten by another player!');
        setPlayerView(null); // Clear player view since they're out of the game
      }
    };
    
    const handleCashOutResult = (result) => {
      console.log('Cash out successful:', result);
      onLeaveGame();
    };
    
    const handleError = (error) => {
      console.error('Game error:', error);
      setConnectionStatus(`Error: ${error.message || error}`);
    };
    
    // Register all event listeners
    socket.on('joined_game', handleJoinedGame);
    socket.on('game_state', handleGameState);
    socket.on('player_view', handlePlayerView);
    socket.on('player_eliminated', handlePlayerEliminated);
    socket.on('cash_out_result', handleCashOutResult);
    socket.on('error', handleError);
    
    // Clean up
    return () => {
      console.log('Cleaning up game connection');
      socket.off('joined_game', handleJoinedGame);
      socket.off('game_state', handleGameState);
      socket.off('player_view', handlePlayerView);
      socket.off('player_eliminated', handlePlayerEliminated);
      socket.off('cash_out_result', handleCashOutResult);
      socket.off('error', handleError);
    };
  }, [socket, publicKey, nickname, initialStake, onLeaveGame]);
  
  // Send player input
  useEffect(() => {
    if (!socket || !isConnected || !publicKey || isPlayerDead) return;
    
    const sendInput = () => {
      socket.emit('player_input', {
        playerAddress: publicKey.toString(),
        input: inputRef.current
      });
      
      // Reset one-time actions
      inputRef.current.split = false;
      inputRef.current.eject = false;
    };
    
    const interval = setInterval(sendInput, 33); // 30 FPS
    
    return () => clearInterval(interval);
  }, [socket, isConnected, publicKey, isPlayerDead]);
  
  // Mouse handling
  const handleMouseMove = useCallback((e) => {
    if (!canvasRef.current || isPlayerDead) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setMousePosition({ x, y });
    
    // Convert to game world coordinates
    if (playerView && playerView.player) {
      const canvas = canvasRef.current;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      
      // Calculate zoom level
      const screenSize = Math.min(canvas.width, canvas.height);
      const baseZoom = screenSize / 800;
      const playerZoom = Math.max(0.8, Math.min(1.5, 100 / (playerView.player.radius * 0.3 + 50)));
      const zoomLevel = baseZoom * playerZoom;
      
      // Calculate position in game world with zoom
      const worldX = playerView.player.x + (x - centerX) / zoomLevel;
      const worldY = playerView.player.y + (y - centerY) / zoomLevel;
      
      inputRef.current.mouseX = worldX;
      inputRef.current.mouseY = worldY;
    }
  }, [playerView, isPlayerDead]);
  
  // Keyboard handling
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (isPlayerDead) return;
      
      switch(e.key) {
        case ' ':
          e.preventDefault();
          inputRef.current.split = true;
          break;
        case 'w':
        case 'W':
          e.preventDefault();
          inputRef.current.eject = true;
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlayerDead]);
  
  // Handle cash out
  const handleCashOut = async () => {
    if (!playerView || !playerView.player || isCashingOut) return;
    
    if (playerView.player.solValue === 0) {
      alert('You have no SOL to cash out!');
      return;
    }
    
    setShowCashOutModal(true);
  };
  
  const confirmCashOut = async () => {
    try {
      setIsCashingOut(true);
      
      // Execute blockchain transaction
      const result = await cashOut(wallet);
      
      // Notify server
      socket.emit('cash_out', {
        playerAddress: publicKey.toString()
      });
      
      alert(
        `💰 Cash out successful!\n\n` +
        `You cashed out: ${result.cashOutAmount.toFixed(4)} SOL\n` +
        `Platform fee (5%): ${result.platformFee.toFixed(4)} SOL\n` +
        `Total received: ${result.playerReceived.toFixed(4)} SOL`
      );
      
      onLeaveGame();
    } catch (error) {
      console.error('Error cashing out:', error);
      alert(`Error cashing out: ${error.message}`);
    } finally {
      setIsCashingOut(false);
      setShowCashOutModal(false);
    }
  };
  
  // Format SOL value
  const formatSol = (lamports) => {
    return (lamports / 1000000000).toFixed(4);
  };
  
  // Show loading screen if no player view yet and not dead
  if (!playerView && !isPlayerDead) {
    return (
      <div className="game-container">
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
          color: '#333'
        }}>
          <h2>{connectionStatus}</h2>
          <div className="spinner" style={{ margin: '20px auto' }}></div>
          <p>Waiting for game data...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="game-container">
      {/* Game UI - only show if player is alive */}
      {playerView && !isPlayerDead && (
        <div className="game-ui">
          {/* Leaderboard */}
          <div className="leaderboard">
            <h3>Leaderboard</h3>
            {gameState?.leaderboard?.map((player, index) => (
              <div key={player.address} className="leaderboard-item">
                <span className="rank">{player.rank}.</span>
                <span className="nickname">{player.nickname}</span>
                <span className="sol">{player.solDisplay} SOL</span>
              </div>
            ))}
          </div>
          
          {/* Player info */}
          {playerView?.player && (
            <div className="player-info">
              <div className="info-item">
                <span>Your Value:</span>
                <span className="value sol-value">
                  {formatSol(playerView.player.solValue)} SOL
                </span>
              </div>
              <div className="info-item">
                <span>Mass:</span>
                <span className="value">{Math.floor(playerView.player.mass)}</span>
              </div>
              <div className="info-item">
                <span>Players Eaten:</span>
                <span className="value">{playerView.player.playersEaten || 0}</span>
              </div>
              <div className="info-item">
                <span>Position:</span>
                <span className="value">
                  {Math.floor(playerView.player.x)}, {Math.floor(playerView.player.y)}
                </span>
              </div>
            </div>
          )}
          
          {/* Game stats */}
          {gameState && (
            <div className="game-info">
              <div className="info-item">
                <span>Active Players:</span>
                <span className="value">{gameState.playerCount}</span>
              </div>
              <div className="info-item">
                <span>Total SOL in Game:</span>
                <span className="value">{gameState.totalSolDisplay} SOL</span>
              </div>
            </div>
          )}
          
          {/* Controls */}
          <div className="controls">
            <div className="control-item">
              <kbd>Mouse</kbd> - Move
            </div>
            <div className="control-item">
              <kbd>Space</kbd> - Boost (-10% mass)
            </div>
            <div className="control-item">
              <kbd>W</kbd> - Eject mass
            </div>
          </div>
          
          {/* Cash out button */}
          {playerView?.player && playerView.player.isAlive && (
            <button 
              className="cash-out-btn"
              onClick={handleCashOut}
              disabled={isCashingOut}
            >
              💰 Cash Out ({formatSol(playerView.player.solValue)} SOL)
            </button>
          )}
        </div>
      )}
      
      {/* Game canvas - only show if player is alive */}
      {playerView && !isPlayerDead && (
        <Canvas
          ref={canvasRef}
          playerView={playerView}
          onMouseMove={handleMouseMove}
        />
      )}
      
      {/* Death screen - nowa wersja bez respawnu */}
      {isPlayerDead && (
        <div className="death-overlay">
          <div className="death-content">
            <h1>Game Over!</h1>
            <p className="death-reason">{deathReason}</p>
            <p>You lost all your SOL!</p>
            <button className="leave-btn" onClick={onLeaveGame}>
              Back to Menu
            </button>
          </div>
        </div>
      )}
      
      {/* Cash out modal */}
      {showCashOutModal && playerView?.player && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Confirm Cash Out</h2>
            <div className="cash-out-info">
              <div className="info-row">
                <span>Current Value:</span>
                <span>{formatSol(playerView.player.solValue)} SOL</span>
              </div>
              <div className="info-row">
                <span>Platform Fee (5%):</span>
                <span>{formatSol(playerView.player.solValue * 0.05)} SOL</span>
              </div>
              <div className="info-row highlight">
                <span>You'll Receive:</span>
                <span>{formatSol(playerView.player.solValue * 0.95)} SOL</span>
              </div>
            </div>
            <p className="warning">
              Are you sure you want to cash out and leave the game?
            </p>
            <div className="modal-buttons">
              <button 
                className="cancel-btn"
                onClick={() => setShowCashOutModal(false)}
                disabled={isCashingOut}
              >
                Cancel
              </button>
              <button 
                className="confirm-btn"
                onClick={confirmCashOut}
                disabled={isCashingOut}
              >
                {isCashingOut ? 'Processing...' : 'Confirm Cash Out'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Exit button - tylko jeśli gracz żyje */}
      {playerView && !isPlayerDead && (
        <button className="exit-btn" onClick={onLeaveGame}>
          Leave Game
        </button>
      )}
    </div>
  );
}