// src/components/Game.js
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import Canvas from './Canvas';
import { connectToGameServer, claimPrize, endGame } from '../utils/SolanaTransactions';
import './Game.css';

export default function Game({ roomId, roomInfo, onBack }) {
  const wallet = useWallet();
  const { publicKey } = wallet;
  
  const [gameState, setGameState] = useState(null);
  const [playerView, setPlayerView] = useState(null);
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [nickname, setNickname] = useState('');
  const [showNicknameInput, setShowNicknameInput] = useState(true);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isGameEnded, setIsGameEnded] = useState(false);
  const [winner, setWinner] = useState(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isEndingGame, setIsEndingGame] = useState(false);
  const [gameEndedOnBlockchain, setGameEndedOnBlockchain] = useState(false);
  const [nicknameTimeout, setNicknameTimeout] = useState(null);
  const endGameAttemptedRef = useRef(false);
  
  const canvasRef = useRef(null);
  const inputRef = useRef({
    mouseX: 0,
    mouseY: 0,
    split: false,
    eject: false
  });
  
  // Auto-start po 15 sekundach jeśli nick nie został podany
  useEffect(() => {
    if (showNicknameInput) {
      const timeout = setTimeout(() => {
        // Jeśli po 15 sekundach nie ma nicku, użyj adresu
        if (!nickname) {
          const defaultNick = publicKey.toString().substring(0, 8);
          setNickname(defaultNick);
          handleSetNickname(defaultNick);
        }
      }, 15000);
      
      setNicknameTimeout(timeout);
      
      return () => {
        if (timeout) clearTimeout(timeout);
      };
    }
  }, [showNicknameInput, nickname, publicKey]);
  
  // Connect to game server
  useEffect(() => {
    if (!roomId || !publicKey || showNicknameInput) return;
    
    const connect = async () => {
      try {
        const io = await connectToGameServer(roomId, publicKey.toString());
        setSocket(io);
        setIsConnected(true);
        
        // Join game
        io.emit('join_game', {
          roomId,
          playerAddress: publicKey.toString()
        });
        
        // Set nickname if we have it
        if (nickname) {
          io.emit('set_nickname', {
            roomId,
            playerAddress: publicKey.toString(),
            nickname: nickname.trim()
          });
        }
        
        // Listen for updates
        io.on('game_state', (state) => {
          setGameState(state);
        });
        
        io.on('player_view', (view) => {
          setPlayerView(view);
        });
        
        io.on('player_eliminated', (data) => {
          if (data.playerAddress === publicKey.toString()) {
            // Player was eliminated
            setPlayerView(prev => ({
              ...prev,
              player: { ...prev?.player, isAlive: false }
            }));
          }
        });
        
        io.on('game_ended', async (data) => {
          console.log('Game ended event received:', data);
          setIsGameEnded(true);
          setWinner(data.winner);
          
          // If game was ended on blockchain, mark it
          if (data.blockchainConfirmed) {
            setGameEndedOnBlockchain(true);
            endGameAttemptedRef.current = true;
          }
          
          // If you won and transaction wasn't sent yet
          if (data.winner === publicKey.toString() && 
              !data.blockchainConfirmed && 
              !isEndingGame && 
              !gameEndedOnBlockchain &&
              !endGameAttemptedRef.current) {
            
            console.log('Attempting to end game on blockchain...');
            endGameAttemptedRef.current = true;
            setIsEndingGame(true);
            
            try {
              const result = await endGame(roomId, data.winner, wallet);
              if (result.alreadyEnded) {
                console.log('Game already ended on blockchain');
                setGameEndedOnBlockchain(true);
              } else {
                console.log('Game ended successfully on blockchain');
                setGameEndedOnBlockchain(true);
              }
            } catch (error) {
              // Check if error means game was already ended
              if (error.message && (error.message.includes('invalid account data') || 
                  error.message.includes('already been processed'))) {
                console.log('Game already ended on blockchain');
                setGameEndedOnBlockchain(true);
              } else {
                console.error('Error ending game on blockchain:', error);
                // On error, reset flag to allow retry
                endGameAttemptedRef.current = false;
              }
            } finally {
              setIsEndingGame(false);
            }
          }
        });
        
        io.on('error', (error) => {
          console.error('Game error:', error);
        });
      } catch (error) {
        console.error('Error connecting to game server:', error);
      }
    };
    
    connect();
    
    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, [roomId, publicKey, wallet, showNicknameInput, nickname]);
  
  // Send player input with increased rate for smoother gameplay
  useEffect(() => {
    if (!socket || !isConnected) return;
    
    const sendInput = () => {
      socket.emit('player_input', {
        roomId,
        playerAddress: publicKey.toString(),
        input: inputRef.current
      });
      
      // Reset one-time actions
      inputRef.current.split = false;
      inputRef.current.eject = false;
    };
    
    const interval = setInterval(sendInput, 33); // 30 times per second (zwiększone z 50ms)
    
    return () => clearInterval(interval);
  }, [socket, isConnected, roomId, publicKey]);
  
  // Mouse handling
  const handleMouseMove = useCallback((e) => {
    if (!canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setMousePosition({ x, y });
    
    // Convert to game world coordinates
    if (playerView && playerView.player) {
      const canvas = canvasRef.current;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      
      // Calculate position in game world
      const worldX = playerView.player.x + (x - centerX);
      const worldY = playerView.player.y + (y - centerY);
      
      inputRef.current.mouseX = worldX;
      inputRef.current.mouseY = worldY;
    }
  }, [playerView]);
  
  // Keyboard handling
  useEffect(() => {
    const handleKeyDown = (e) => {
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
  }, []);
  
  // Set nickname
  const handleSetNickname = (customNick = null) => {
    const finalNick = customNick || nickname.trim();
    
    if (!finalNick) {
      // Jeśli nie ma nicku, użyj początku adresu
      const defaultNick = publicKey.toString().substring(0, 8);
      setNickname(defaultNick);
    }
    
    // Wyczyść timeout jeśli istnieje
    if (nicknameTimeout) {
      clearTimeout(nicknameTimeout);
      setNicknameTimeout(null);
    }
    
    setShowNicknameInput(false);
  };
  
  // Claim prize
  const handleClaimPrize = async () => {
    if (!winner || winner !== publicKey.toString() || isClaiming) return;
    
    try {
      setIsClaiming(true);
      const result = await claimPrize(roomId, wallet);
      
      alert(
        `🎉 Congratulations!\n\n` +
        `💰 Total pool: ${result.totalPrize.toFixed(2)} SOL\n` +
        `🏆 Your prize (95%): ${result.prize.toFixed(2)} SOL\n` +
        `🏛️ Platform fee (5%): ${result.platformFee.toFixed(2)} SOL\n\n` +
        `Prize has been sent to your wallet!`
      );
      
      onBack();
    } catch (error) {
      console.error('Error claiming prize:', error);
      alert(`Error claiming prize: ${error.message}`);
    } finally {
      setIsClaiming(false);
    }
  };
  
  // Format time
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  // Calculate remaining game time
  const calculateRemainingTime = () => {
    if (!roomInfo.gameStartedAt || !roomInfo.gameDuration) return null;
    
    const startTime = new Date(roomInfo.gameStartedAt).getTime();
    const duration = roomInfo.gameDuration * 60 * 1000; // minutes to ms
    const endTime = startTime + duration;
    const now = Date.now();
    
    const remaining = Math.max(0, endTime - now);
    return Math.floor(remaining / 1000); // seconds
  };
  
  const [remainingTime, setRemainingTime] = useState(null);
  
  useEffect(() => {
    const interval = setInterval(() => {
      const time = calculateRemainingTime();
      setRemainingTime(time);
      
      if (time === 0 && !isGameEnded) {
        // Game should end
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [roomInfo, isGameEnded]);
  
  if (showNicknameInput) {
    return (
      <div className="nickname-screen">
        <h2>Choose your name</h2>
        <input
          type="text"
          placeholder="Enter nickname..."
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={20}
          onKeyPress={(e) => e.key === 'Enter' && handleSetNickname()}
          autoFocus
        />
        <button onClick={() => handleSetNickname()}>Start game</button>
        <button onClick={onBack} className="back-btn">Back</button>
        <p style={{ marginTop: '20px', color: '#95A5A6', fontSize: '14px' }}>
          Game will start automatically in {15 - Math.floor((Date.now() % 15000) / 1000)} seconds...
        </p>
      </div>
    );
  }
  
  return (
    <div className="game-container">
      {/* UI Overlay */}
      <div className="game-ui">
        {/* Leaderboard */}
        <div className="leaderboard">
          <h3>Leaderboard</h3>
          {gameState?.leaderboard?.map((player, index) => (
            <div key={player.address} className="leaderboard-item">
              <span className="rank">{player.rank}.</span>
              <span className="nickname">{player.nickname}</span>
              <span className="mass">{player.mass}</span>
            </div>
          ))}
        </div>
        
        {/* Game info */}
        <div className="game-info">
          <div className="info-item">
            <span>Players:</span>
            <span>{gameState?.playerCount || 0}</span>
          </div>
          <div className="info-item">
            <span>Time left:</span>
            <span className="timer">
              {remainingTime !== null ? formatTime(remainingTime) : '--:--'}
            </span>
          </div>
          {playerView?.player && (
            <>
              <div className="info-item">
                <span>Mass:</span>
                <span>{Math.floor(playerView.player.mass)}</span>
              </div>
              <div className="info-item">
                <span>Position:</span>
                <span>
                  {Math.floor(playerView.player.x)}, {Math.floor(playerView.player.y)}
                </span>
              </div>
            </>
          )}
        </div>
        
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
      </div>
      
      {/* Game canvas */}
      <Canvas
        ref={canvasRef}
        playerView={playerView}
        onMouseMove={handleMouseMove}
      />
      
      {/* Elimination screen (for eaten player) */}
      {playerView && !playerView.player.isAlive && !isGameEnded && (
        <div className="game-over-overlay">
          <div className="game-over-content">
            <h1>You were eaten!</h1>
            <p>You can watch the rest of the game or return to lobby.</p>
            
            <div className="spectator-info">
              <h3>Players remaining: {gameState?.playerCount || 0}</h3>
            </div>
            
            <button onClick={onBack} className="back-btn">
              Back to lobby
            </button>
          </div>
        </div>
      )}
      
      {/* Game end screen */}
      {isGameEnded && (
        <div className="game-over-overlay">
          <div className="game-over-content">
            <h1>Game Over!</h1>
            {winner === publicKey?.toString() ? (
              <>
                <h2 className="winner-text">🎉 You won! 🎉</h2>
                <p>Congratulations! You are the last survivor.</p>
                <button 
                  className="claim-btn"
                  onClick={handleClaimPrize}
                  disabled={isClaiming}
                >
                  {isClaiming ? 'Claiming...' : 'Claim prize'}
                </button>
              </>
            ) : (
              <>
                <h2>You lost</h2>
                <p>Winner: {winner?.substring(0, 8)}...</p>
                <button onClick={onBack}>Back to lobby</button>
              </>
            )}
            
            {/* Final leaderboard */}
            <div className="final-leaderboard">
              <h3>Final ranking</h3>
              {gameState?.leaderboard?.map((player, index) => (
                <div key={player.address} className="leaderboard-item">
                  <span className="rank">{player.rank}.</span>
                  <span className="nickname">{player.nickname}</span>
                  <span className="mass">{player.mass}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      
      {/* Exit button */}
      {!isGameEnded && (
        <button className="exit-btn" onClick={onBack}>
          Leave game
        </button>
      )}
    </div>
  );
}