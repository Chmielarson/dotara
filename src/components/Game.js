// src/components/Game.js
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import Canvas from './Canvas';
import { cashOut } from '../utils/SolanaTransactions';
import './Game.css';

export default function Game({ initialStake, nickname, onLeaveGame, socket }) {
  const wallet = useWallet();
  const { publicKey } = wallet;
  
  // Dodaj logi na początku
  console.log('Game component mounted with:', {
    initialStake,
    nickname,
    socket: socket ? 'Socket exists' : 'No socket',
    socketConnected: socket?.connected,
    publicKey: publicKey?.toString()
  });
  
  const [gameState, setGameState] = useState(null);
  const [playerView, setPlayerView] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isPlayerDead, setIsPlayerDead] = useState(false);
  const [canRespawn, setCanRespawn] = useState(false);
  const [isCashingOut, setIsCashingOut] = useState(false);
  const [showCashOutModal, setShowCashOutModal] = useState(false);
  const [playerJoined, setPlayerJoined] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Initializing...'); // Ten useState brakowało!
  
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
    if (!socket || !publicKey || playerJoined) {
      console.log('Skipping join - conditions not met:', { 
        socket: !!socket, 
        publicKey: !!publicKey, 
        playerJoined 
      });
      return;
    }
    
    setConnectionStatus('Connecting to game server...');
    
    console.log('Emitting join_game with:', {
      playerAddress: publicKey.toString(),
      nickname: nickname,
      initialStake: initialStake
    });
    
    socket.emit('join_game', {
      playerAddress: publicKey.toString(),
      nickname: nickname,
      initialStake: initialStake
    });
    
    socket.on('joined_game', (data) => {
      console.log('Received joined_game:', data);
      if (data.success) {
        setIsConnected(true);
        setPlayerJoined(true);
        setConnectionStatus('Connected! Waiting for game data...');
      } else {
        setConnectionStatus('Failed to join game');
      }
    });
    
    socket.on('game_state', (state) => {
      console.log('Received game_state');
      setGameState(state);
    });
    
    socket.on('player_view', (view) => {
      // Log tylko co sekundę żeby nie zaśmiecać konsoli
      if (Date.now() % 1000 < 50) {
        console.log('Received player_view:', {
          hasPlayer: !!view?.player,
          playerAlive: view?.player?.isAlive,
          playerPos: view?.player ? `${Math.floor(view.player.x)}, ${Math.floor(view.player.y)}` : 'N/A',
          foodCount: view?.food?.length,
          playersCount: view?.players?.length
        });
      }
      
      setPlayerView(view);
      setConnectionStatus('In game');
      
      if (view.player && !view.player.isAlive) {
        setIsPlayerDead(true);
        setCanRespawn(view.canRespawn);
      } else {
        setIsPlayerDead(false);
      }
    });
    
    socket.on('player_eliminated', (data) => {
      if (data.playerAddress === publicKey.toString()) {
        setIsPlayerDead(true);
        setCanRespawn(data.canRespawn);
      }
    });
    
    socket.on('cash_out_result', (result) => {
      console.log('Cash out successful:', result);
      onLeaveGame();
    });
    
    socket.on('connect', () => {
      console.log('Socket connected');
      setConnectionStatus('Socket connected');
    });
    
    socket.on('disconnect', () => {
      console.log('Socket disconnected');
      setConnectionStatus('Disconnected from server');
    });
    
    socket.on('error', (error) => {
      console.error('Socket error:', error);
      setConnectionStatus('Connection error: ' + error.message);
    });
    
    return () => {
      socket.off('joined_game');
      socket.off('game_state');
      socket.off('player_view');
      socket.off('player_eliminated');
      socket.off('cash_out_result');
      socket.off('error');
      socket.off('connect');
      socket.off('disconnect');
    };
  }, [socket, publicKey, nickname, initialStake, playerJoined, onLeaveGame]);
  
  // Send player input
  useEffect(() => {
    if (!socket || !isConnected || !playerJoined) return;
    
    const sendInput = () => {
      const currentInput = {
        mouseX: inputRef.current.mouseX,
        mouseY: inputRef.current.mouseY,
        split: inputRef.current.split,
        eject: inputRef.current.eject
      };
      
      // Debug log co sekundę
      if (Date.now() % 1000 < 33) {
        console.log('Sending input:', currentInput);
      }
      
      socket.emit('player_input', {
        playerAddress: publicKey.toString(),
        input: currentInput
      });
      
      // Reset one-time actions
      inputRef.current.split = false;
      inputRef.current.eject = false;
    };
    
    const interval = setInterval(sendInput, 33); // 30 times per second
    
    return () => clearInterval(interval);
  }, [socket, isConnected, playerJoined, publicKey]);
  
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
      
      // Calculate position in game world
      const worldX = playerView.player.x + (x - centerX) / zoomLevel;
      const worldY = playerView.player.y + (y - centerY) / zoomLevel;
      
      inputRef.current.mouseX = worldX;
      inputRef.current.mouseY = worldY;
      
      // Debug log
      console.log('Mouse input:', {
        screen: { x, y },
        world: { x: worldX, y: worldY },
        player: { x: playerView.player.x, y: playerView.player.y },
        zoom: zoomLevel
      });
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
  
  // Handle respawn
  const handleRespawn = () => {
    if (!canRespawn || !socket) return;
    
    socket.emit('respawn', {
      playerAddress: publicKey.toString()
    });
    
    setIsPlayerDead(false);
  };
  
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
  
  // Add useEffect to check canvas ref
  useEffect(() => {
    console.log('Canvas ref status:', { 
      hasRef: !!canvasRef.current,
      element: canvasRef.current 
    });
  }, []);
  
  return (
    <div className="game-container">
      {/* Debug info - usuń po naprawieniu */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.8)',
        color: 'white',
        padding: '10px',
        borderRadius: '5px',
        zIndex: 1000,
        fontSize: '12px',
        maxWidth: '400px',
        wordWrap: 'break-word'
      }}>
        <div>Status: {connectionStatus}</div>
        <div>Socket: {socket ? 'Yes' : 'No'}</div>
        <div>Connected: {socket?.connected ? 'Yes' : 'No'}</div>
        <div>Player joined: {playerJoined ? 'Yes' : 'No'}</div>
        <div>Has view: {playerView ? 'Yes' : 'No'}</div>
        <div>Canvas ref: {canvasRef.current ? 'Yes' : 'No'}</div>
        {playerView && (
          <>
            <div>Player pos: {Math.floor(playerView.player?.x)}, {Math.floor(playerView.player?.y)}</div>
            <div>Player alive: {playerView.player?.isAlive ? 'Yes' : 'No'}</div>
            <div>Food count: {playerView.food?.length}</div>
            <div>Players count: {playerView.players?.length}</div>
            <div>Time: {new Date().toLocaleTimeString()}</div>
          </>
        )}
      </div>
      
      {/* Game UI */}
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
      
      {/* Game canvas */}
      <Canvas
        ref={canvasRef}
        playerView={playerView}
        onMouseMove={handleMouseMove}
      />
      
      {/* Death screen */}
      {isPlayerDead && (
        <div className="death-overlay">
          <div className="death-content">
            <h1>You were eaten!</h1>
            {canRespawn && playerView?.player ? (
              <>
                <p>You still have {formatSol(playerView.player.solValue)} SOL</p>
                <div className="death-options">
                  <button className="respawn-btn" onClick={handleRespawn}>
                    Respawn
                  </button>
                  <button className="cash-out-death-btn" onClick={handleCashOut}>
                    Cash Out & Leave
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>You lost all your SOL!</p>
                <button className="leave-btn" onClick={onLeaveGame}>
                  Back to Menu
                </button>
              </>
            )}
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
      
      {/* Exit button */}
      <button className="exit-btn" onClick={onLeaveGame}>
        Leave Game
      </button>
    </div>
  );
}