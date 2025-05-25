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
  
  const canvasRef = useRef(null);
  const inputRef = useRef({
    mouseX: 0,
    mouseY: 0,
    split: false,
    eject: false
  });
  
  // Połączenie z serwerem gry
  useEffect(() => {
    if (!roomId || !publicKey) return;
    
    const connect = async () => {
      try {
        const io = await connectToGameServer(roomId, publicKey.toString());
        setSocket(io);
        setIsConnected(true);
        
        // Dołącz do gry
        io.emit('join_game', {
          roomId,
          playerAddress: publicKey.toString()
        });
        
        // Nasłuchuj na aktualizacje
        io.on('game_state', (state) => {
          setGameState(state);
        });
        
        io.on('player_view', (view) => {
          setPlayerView(view);
        });
        
        io.on('game_ended', async (data) => {
          setIsGameEnded(true);
          setWinner(data.winner);
          
          // Jeśli wygrałeś, automatycznie zakończ grę na blockchainie
          if (data.winner === publicKey.toString() && !data.blockchainConfirmed) {
            try {
              await endGame(roomId, data.winner, wallet);
            } catch (error) {
              console.error('Error ending game on blockchain:', error);
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
  }, [roomId, publicKey, wallet]);
  
  // Wysyłanie inputu gracza
  useEffect(() => {
    if (!socket || !isConnected) return;
    
    const sendInput = () => {
      socket.emit('player_input', {
        roomId,
        playerAddress: publicKey.toString(),
        input: inputRef.current
      });
      
      // Reset jednorazowych akcji
      inputRef.current.split = false;
      inputRef.current.eject = false;
    };
    
    const interval = setInterval(sendInput, 50); // 20 razy na sekundę
    
    return () => clearInterval(interval);
  }, [socket, isConnected, roomId, publicKey]);
  
  // Obsługa myszy
  const handleMouseMove = useCallback((e) => {
    if (!canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setMousePosition({ x, y });
    
    // Konwertuj na współrzędne świata gry
    if (playerView && playerView.player) {
      const canvas = canvasRef.current;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      
      // Oblicz pozycję w świecie gry
      const worldX = playerView.player.x + (x - centerX);
      const worldY = playerView.player.y + (y - centerY);
      
      inputRef.current.mouseX = worldX;
      inputRef.current.mouseY = worldY;
    }
  }, [playerView]);
  
  // Obsługa klawiatury
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
  
  // Ustawienie nicku
  const handleSetNickname = () => {
    if (!nickname.trim() || !socket) return;
    
    socket.emit('set_nickname', {
      roomId,
      playerAddress: publicKey.toString(),
      nickname: nickname.trim()
    });
    
    setShowNicknameInput(false);
  };
  
  // Odebranie nagrody
  const handleClaimPrize = async () => {
    if (!winner || winner !== publicKey.toString() || isClaiming) return;
    
    try {
      setIsClaiming(true);
      const result = await claimPrize(roomId, wallet);
      
      alert(
        `🎉 Gratulacje!\n\n` +
        `💰 Całkowita pula: ${result.totalPrize.toFixed(2)} SOL\n` +
        `🏆 Twoja nagroda (95%): ${result.prize.toFixed(2)} SOL\n` +
        `🏛️ Prowizja platformy (5%): ${result.platformFee.toFixed(2)} SOL\n\n` +
        `Nagroda została przesłana do Twojego portfela!`
      );
      
      onBack();
    } catch (error) {
      console.error('Error claiming prize:', error);
      alert(`Błąd podczas odbierania nagrody: ${error.message}`);
    } finally {
      setIsClaiming(false);
    }
  };
  
  // Formatowanie czasu
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  // Oblicz pozostały czas gry
  const calculateRemainingTime = () => {
    if (!roomInfo.gameStartedAt || !roomInfo.gameDuration) return null;
    
    const startTime = new Date(roomInfo.gameStartedAt).getTime();
    const duration = roomInfo.gameDuration * 60 * 1000; // minuty na ms
    const endTime = startTime + duration;
    const now = Date.now();
    
    const remaining = Math.max(0, endTime - now);
    return Math.floor(remaining / 1000); // sekundy
  };
  
  const [remainingTime, setRemainingTime] = useState(null);
  
  useEffect(() => {
    const interval = setInterval(() => {
      const time = calculateRemainingTime();
      setRemainingTime(time);
      
      if (time === 0 && !isGameEnded) {
        // Gra powinna się zakończyć
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [roomInfo, isGameEnded]);
  
  if (showNicknameInput) {
    return (
      <div className="nickname-screen">
        <h2>Wybierz swoją nazwę</h2>
        <input
          type="text"
          placeholder="Wpisz nick..."
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={20}
          onKeyPress={(e) => e.key === 'Enter' && handleSetNickname()}
          autoFocus
        />
        <button onClick={handleSetNickname}>Rozpocznij grę</button>
        <button onClick={onBack} className="back-btn">Wróć</button>
      </div>
    );
  }
  
  return (
    <div className="game-container">
      {/* UI Overlay */}
      <div className="game-ui">
        {/* Leaderboard */}
        <div className="leaderboard">
          <h3>Ranking</h3>
          {gameState?.leaderboard?.map((player, index) => (
            <div key={player.address} className="leaderboard-item">
              <span className="rank">{player.rank}.</span>
              <span className="nickname">{player.nickname}</span>
              <span className="mass">{player.mass}</span>
            </div>
          ))}
        </div>
        
        {/* Informacje o grze */}
        <div className="game-info">
          <div className="info-item">
            <span>Gracze:</span>
            <span>{gameState?.playerCount || 0}</span>
          </div>
          <div className="info-item">
            <span>Pozostały czas:</span>
            <span className="timer">
              {remainingTime !== null ? formatTime(remainingTime) : '--:--'}
            </span>
          </div>
          {playerView?.player && (
            <>
              <div className="info-item">
                <span>Masa:</span>
                <span>{Math.floor(playerView.player.mass)}</span>
              </div>
              <div className="info-item">
                <span>Pozycja:</span>
                <span>
                  {Math.floor(playerView.player.x)}, {Math.floor(playerView.player.y)}
                </span>
              </div>
            </>
          )}
        </div>
        
        {/* Kontrolki */}
        <div className="controls">
          <div className="control-item">
            <kbd>Mysz</kbd> - Ruch
          </div>
          <div className="control-item">
            <kbd>Spacja</kbd> - Podział
          </div>
          <div className="control-item">
            <kbd>W</kbd> - Wyrzuć masę
          </div>
        </div>
      </div>
      
      {/* Canvas gry */}
      <Canvas
        ref={canvasRef}
        playerView={playerView}
        onMouseMove={handleMouseMove}
      />
      
      {/* Ekran końca gry */}
      {isGameEnded && (
        <div className="game-over-overlay">
          <div className="game-over-content">
            <h1>Gra zakończona!</h1>
            {winner === publicKey?.toString() ? (
              <>
                <h2 className="winner-text">🎉 Wygrałeś! 🎉</h2>
                <p>Gratulacje! Jesteś ostatnim ocalałym.</p>
                <button 
                  className="claim-btn"
                  onClick={handleClaimPrize}
                  disabled={isClaiming}
                >
                  {isClaiming ? 'Odbieranie...' : 'Odbierz nagrodę'}
                </button>
              </>
            ) : (
              <>
                <h2>Przegrałeś</h2>
                <p>Zwycięzca: {winner?.substring(0, 8)}...</p>
                <button onClick={onBack}>Wróć do lobby</button>
              </>
            )}
            
            {/* Końcowy ranking */}
            <div className="final-leaderboard">
              <h3>Końcowy ranking</h3>
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
      
      {/* Przycisk wyjścia */}
      {!isGameEnded && (
        <button className="exit-btn" onClick={onBack}>
          Opuść grę
        </button>
      )}
    </div>
  );
}