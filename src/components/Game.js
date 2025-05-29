// src/components/Game.js
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import Canvas from './Canvas';
import { cashOut } from '../utils/SolanaTransactions';
import { useOptimizedSocket } from '../hooks/useOptimizedSocket';
import './Game.css';

export default function Game({ initialStake, nickname, onLeaveGame, setPendingCashOut, socket }) {
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
  const [combatCooldown, setCombatCooldown] = useState(0);
  const [roomId, setRoomId] = useState(null);
  const [deltaUpdates, setDeltaUpdates] = useState(false); // Feature flag
  
  const canvasRef = useRef(null);
  const inputRef = useRef({
    mouseX: 0,
    mouseY: 0,
    split: false,
    eject: false
  });
  
  // Performance monitoring
  const performanceRef = useRef({
    lastUpdate: Date.now(),
    updateCount: 0,
    fps: 0
  });
  
  // Timer dla combat cooldown
  useEffect(() => {
    if (playerView?.player?.combatCooldownRemaining > 0) {
      setCombatCooldown(playerView.player.combatCooldownRemaining);
      
      const timer = setInterval(() => {
        setCombatCooldown(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      
      return () => clearInterval(timer);
    } else {
      setCombatCooldown(0);
    }
  }, [playerView?.player?.combatCooldownRemaining]);
  
  // Zapobiegaj przewijaniu strony podczas gry
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    const originalPosition = document.body.style.position;
    const originalHeight = document.body.style.height;
    
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.height = '100vh';
    document.body.style.width = '100vw';
    
    // Disable touch events that might cause scrolling
    const preventDefaultTouch = (e) => e.preventDefault();
    document.addEventListener('touchmove', preventDefaultTouch, { passive: false });
    
    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.position = originalPosition;
      document.body.style.height = originalHeight;
      document.body.style.width = '';
      document.removeEventListener('touchmove', preventDefaultTouch);
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
        setRoomId(data.roomId);
        setConnectionStatus(`Connected to room ${data.roomId}`);
      }
    };
    
    const handleRoomState = (state) => {
      setGameState(state);
      
      // Performance tracking
      performanceRef.current.updateCount++;
      const now = Date.now();
      if (now - performanceRef.current.lastUpdate >= 1000) {
        performanceRef.current.fps = performanceRef.current.updateCount;
        performanceRef.current.updateCount = 0;
        performanceRef.current.lastUpdate = now;
      }
    };
    
    const handlePlayerView = (view) => {
      if (!view) {
        console.error('Received null player view');
        return;
      }
      
      setPlayerView(view);
      setConnectionStatus(`Room ${view.gameState?.roomId || roomId} - Playing`);
      
      // Initialize mouse position to player position
      if (view.player && inputRef.current.mouseX === 0 && inputRef.current.mouseY === 0) {
        inputRef.current.mouseX = view.player.x;
        inputRef.current.mouseY = view.player.y;
      }
    };
    
    const handlePlayerDelta = (delta) => {
      if (!delta || delta.type === 'full') {
        setPlayerView(delta.data);
        return;
      }
      
      // Apply delta updates
      setPlayerView(prevView => {
        if (!prevView) return null;
        
        const newView = { ...prevView };
        
        // Update player
        if (delta.player) {
          newView.player = { ...prevView.player, ...delta.player };
        }
        
        // Update entities
        if (delta.entities) {
          const entityMap = new Map(prevView.players.map(p => [p.id, p]));
          
          // Add new entities
          delta.entities.added.forEach(entity => {
            entityMap.set(entity.id, entity);
          });
          
          // Update existing entities
          delta.entities.updated.forEach(update => {
            const entity = entityMap.get(update.id);
            if (entity) {
              entityMap.set(update.id, { ...entity, ...update });
            }
          });
          
          // Remove entities
          delta.entities.removed.forEach(id => {
            entityMap.delete(id);
          });
          
          newView.players = Array.from(entityMap.values());
        }
        
        // Update food
        if (delta.food) {
          const foodMap = new Map(prevView.food.map(f => [f.id, f]));
          
          delta.food.added.forEach(food => {
            foodMap.set(food.id, food);
          });
          
          delta.food.removed.forEach(id => {
            foodMap.delete(id);
          });
          
          newView.food = Array.from(foodMap.values());
        }
        
        // Update other fields
        if (delta.leaderboard) newView.leaderboard = delta.leaderboard;
        if (delta.gameState) newView.gameState = { ...prevView.gameState, ...delta.gameState };
        
        return newView;
      });
    };
    
    const handlePlayerEliminated = (data) => {
      console.log('Player eliminated:', data);
      if (data.playerAddress === publicKey.toString()) {
        setIsPlayerDead(true);
        setDeathReason(data.reason || 'You were eaten by another player!');
        setPlayerView(null);
        localStorage.removeItem('dotara_io_game_state');
        localStorage.removeItem('dotara_io_pending_cashout');
      }
    };
    
    const handleCashOutResult = (result) => {
      console.log('Cash out successful:', result);
      onLeaveGame();
    };
    
    const handleError = (error) => {
      console.error('Game error:', error);
      setConnectionStatus(`Error: ${error.message || error}`);
      if (error.message && error.message.includes('eaten')) {
        setIsPlayerDead(true);
        setDeathReason(error.message);
        localStorage.removeItem('dotara_io_game_state');
      }
    };
    
    // Register all event listeners
    socket.on('joined_game', handleJoinedGame);
    socket.on('room_state', handleRoomState);
    socket.on('player_view', handlePlayerView);
    socket.on('player_delta', handlePlayerDelta);
    socket.on('player_eliminated', handlePlayerEliminated);
    socket.on('cash_out_result', handleCashOutResult);
    socket.on('error', handleError);
    
    // Clean up
    return () => {
      console.log('Cleaning up game connection');
      socket.off('joined_game', handleJoinedGame);
      socket.off('room_state', handleRoomState);
      socket.off('player_view', handlePlayerView);
      socket.off('player_delta', handlePlayerDelta);
      socket.off('player_eliminated', handlePlayerEliminated);
      socket.off('cash_out_result', handleCashOutResult);
      socket.off('error', handleError);
    };
  }, [socket, publicKey, nickname, initialStake, onLeaveGame, roomId]);
  
  // Send player input - optimized
  useEffect(() => {
    if (!socket || !isConnected || !publicKey || isPlayerDead) return;
    
    let lastSentInput = { mouseX: 0, mouseY: 0 };
    const inputThreshold = 5; // Minimum movement before sending update
    
    const sendInput = () => {
      // Only send if there's significant change
      const dx = Math.abs(inputRef.current.mouseX - lastSentInput.mouseX);
      const dy = Math.abs(inputRef.current.mouseY - lastSentInput.mouseY);
      
      if (dx > inputThreshold || dy > inputThreshold || 
          inputRef.current.split || inputRef.current.eject) {
        
        socket.emit('player_input', {
          playerAddress: publicKey.toString(),
          input: { ...inputRef.current }
        });
        
        lastSentInput.mouseX = inputRef.current.mouseX;
        lastSentInput.mouseY = inputRef.current.mouseY;
        
        // Reset one-time actions
        inputRef.current.split = false;
        inputRef.current.eject = false;
      }
    };
    
    const interval = setInterval(sendInput, 33); // 30 FPS
    
    return () => clearInterval(interval);
  }, [socket, isConnected, publicKey, isPlayerDead]);
  
  // Mouse handling - optimized
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
  
  // Touch handling for mobile
  const handleTouchMove = useCallback((e) => {
    if (!canvasRef.current || isPlayerDead || e.touches.length === 0) return;
    
    e.preventDefault();
    const touch = e.touches[0];
    const rect = canvasRef.current.getBoundingClientRect();
    
    const fakeMouseEvent = {
      clientX: touch.clientX,
      clientY: touch.clientY
    };
    
    handleMouseMove(fakeMouseEvent);
  }, [handleMouseMove, isPlayerDead]);
  
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
  
  // Touch events for mobile controls
  useEffect(() => {
    const handleTouchStart = (e) => {
      if (isPlayerDead) return;
      
      // Double tap for split
      const now = Date.now();
      if (this.lastTap && now - this.lastTap < 300) {
        e.preventDefault();
        inputRef.current.split = true;
      }
      this.lastTap = now;
    };
    
    if (canvasRef.current) {
      canvasRef.current.addEventListener('touchstart', handleTouchStart);
      canvasRef.current.addEventListener('touchmove', handleTouchMove);
      
      return () => {
        if (canvasRef.current) {
          canvasRef.current.removeEventListener('touchstart', handleTouchStart);
          canvasRef.current.removeEventListener('touchmove', handleTouchMove);
        }
      };
    }
  }, [isPlayerDead, handleTouchMove]);
  
  // Handle cash out
  const handleCashOut = async () => {
    if (!playerView || !playerView.player || isCashingOut) return;
    
    if (playerView.player.solValue === 0) {
      alert('You have no SOL to cash out!');
      return;
    }
    
    // Sprawdź combat cooldown
    if (!playerView.player.canCashOut) {
      console.log('Cannot cash out - in combat!');
      return;
    }
    
    setShowCashOutModal(true);
  };
  
  const confirmCashOut = async () => {
    try {
      setIsCashingOut(true);
      
      // Najpierw usuń gracza z gry na serwerze
      socket.emit('initiate_cash_out', {
        playerAddress: publicKey.toString()
      });
      
      // Czekaj na potwierdzenie usunięcia
      socket.once('cash_out_initiated', async (data) => {
        if (data.success) {
          // Zapisz dane do cash out w localStorage - używaj wartości z serwera!
          const cashOutData = {
            playerAddress: publicKey.toString(),
            amount: data.amount, // Serwer zwraca aktualną wartość gracza
            timestamp: Date.now()
          };
          
          localStorage.setItem('dotara_io_pending_cashout', JSON.stringify(cashOutData));
          
          // Ustaw dane przed przekierowaniem
          setPendingCashOut(cashOutData);
          
          // Przejdź do widoku cash out
          onLeaveGame(true); // true = pending cash out
        } else {
          alert('Failed to initiate cash out. Please try again.');
          setIsCashingOut(false);
        }
      });
      
    } catch (error) {
      console.error('Error initiating cash out:', error);
      alert(`Error: ${error.message}`);
      setIsCashingOut(false);
    } finally {
      setShowCashOutModal(false);
    }
  };
  
  // Format SOL value
  const formatSol = (lamports) => {
    return (lamports / 1000000000).toFixed(4);
  };
  
  // Render cash out button z timerem
  const renderCashOutButton = () => {
    if (!playerView?.player || !playerView.player.isAlive) return null;
    
    const canCashOut = playerView.player.canCashOut;
    const cooldownRemaining = combatCooldown;
    
    if (!canCashOut && cooldownRemaining > 0) {
      // Combat timer button
      const progressWidth = (cooldownRemaining / 10) * 100;
      
      return (
        <button 
          className="cash-out-btn combat-timer"
          disabled={true}
          style={{
            '--progress-width': `${progressWidth}%`
          }}
        >
          <div className="timer-text">
            <span>⚔️</span>
            <span>Combat {cooldownRemaining}s</span>
          </div>
          <style jsx>{`
            .cash-out-btn.combat-timer::before {
              width: var(--progress-width);
            }
          `}</style>
        </button>
      );
    }
    
    // Normal cash out button
    return (
      <button 
        className="cash-out-btn"
        onClick={handleCashOut}
        disabled={isCashingOut || !canCashOut}
      >
        💰 Cash Out ({formatSol(playerView.player.solValue)} SOL)
      </button>
    );
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
          {roomId && <p>Room ID: {roomId}</p>}
        </div>
      </div>
    );
  }
  
  return (
    <div className="game-container">
      {/* Game UI - only show if player is alive */}
      {playerView && !isPlayerDead && (
        <div className="game-ui">
          {/* TOP RIGHT - Leaderboard */}
          <div className="leaderboard">
            <h3>Leaderboard (Room {roomId})</h3>
            {gameState?.leaderboard?.map((player, index) => (
              <div key={player.address} className="leaderboard-item">
                <span className="rank">{player.rank}.</span>
                <span className="nickname">{player.nickname}</span>
                <span className="zone-badge" style={{ 
                  color: player.zone === 1 ? '#CD7F32' : 
                         player.zone === 2 ? '#C0C0C0' : 
                         player.zone === 3 ? '#FFD700' : '#B9F2FF' 
                }}>
                  Z{player.zone}
                </span>
                <span className="sol">{player.solDisplay} SOL</span>
              </div>
            ))}
          </div>
          
          {/* TOP LEFT - Game stats + Player info */}
          {gameState && playerView?.player && (
            <div className="game-info">
              <div className="info-item">
                <span>Room:</span>
                <span className="value">{roomId}/20</span>
              </div>
              <div className="info-item">
                <span>Your Mass:</span>
                <span className="value">{Math.floor(playerView.player.mass)}</span>
              </div>
              <div className="info-item">
                <span>Players Eaten:</span>
                <span className="value">{playerView.player.playersEaten || 0}</span>
              </div>
              <div className="info-item" style={{ marginTop: '10px', paddingTop: '10px', borderTop: '2px solid #ECF0F1' }}>
                <span>Room Players:</span>
                <span className="value">{gameState.playerCount}</span>
              </div>
              <div className="info-item">
                <span>Room SOL:</span>
                <span className="value">{gameState.totalSolDisplay} SOL</span>
              </div>
              {playerView.player.canAdvanceToZone && (
                <div className="info-item" style={{ color: '#16A085', marginTop: '10px' }}>
                  <span>Can advance to:</span>
                  <span className="value">Zone {playerView.player.canAdvanceToZone}</span>
                </div>
              )}
              <div className="info-item" style={{ marginTop: '10px', fontSize: '12px', color: '#7F8C8D' }}>
                <span>FPS:</span>
                <span className="value">{performanceRef.current.fps}</span>
              </div>
            </div>
          )}
          
          {/* BOTTOM LEFT - Controls */}
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
            {window.matchMedia('(max-width: 768px)').matches && (
              <div className="control-item" style={{ marginTop: '5px', fontSize: '12px', color: '#7F8C8D' }}>
                <kbd>Double Tap</kbd> - Boost
              </div>
            )}
          </div>
          
          {/* BOTTOM CENTER - Action buttons */}
          <div className="action-buttons">
            {renderCashOutButton()}
            <button className="exit-btn" onClick={onLeaveGame}>
              Leave Game
            </button>
          </div>
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
      
      {/* Death screen */}
      {isPlayerDead && (
        <div className="death-overlay">
          <div className="death-content">
            <h1>Game Over!</h1>
            <p className="death-reason">{deathReason}</p>
            <p>You lost all your SOL!</p>
            <button 
              className="leave-btn" 
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Back to menu clicked');
                localStorage.removeItem('dotara_io_game_state');
                localStorage.removeItem('dotara_io_pending_cashout');
                try {
                  onLeaveGame();
                } catch (error) {
                  console.error('Error leaving game:', error);
                  window.location.href = '/';
                }
              }}
            >
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
    </div>
  );
}