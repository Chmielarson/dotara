// src/components/Canvas.js
import React, { useRef, useEffect, forwardRef } from 'react';

const Canvas = forwardRef(({ playerView, onMouseMove }, ref) => {
  const animationRef = useRef();
  const gridPatternRef = useRef();
  
  useEffect(() => {
    if (!ref.current) return;
    
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    
    // Ustaw rozmiar canvas
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // Stwórz wzór siatki
    const createGridPattern = () => {
      const patternCanvas = document.createElement('canvas');
      const patternCtx = patternCanvas.getContext('2d');
      const gridSize = 50;
      
      patternCanvas.width = gridSize;
      patternCanvas.height = gridSize;
      
      // Białe tło
      patternCtx.fillStyle = '#ffffff';
      patternCtx.fillRect(0, 0, gridSize, gridSize);
      
      // Szara kratka
      patternCtx.strokeStyle = '#f0f0f0';
      patternCtx.lineWidth = 1;
      
      // Rysuj linie siatki
      patternCtx.beginPath();
      patternCtx.moveTo(gridSize, 0);
      patternCtx.lineTo(gridSize, gridSize);
      patternCtx.moveTo(0, gridSize);
      patternCtx.lineTo(gridSize, gridSize);
      patternCtx.stroke();
      
      return ctx.createPattern(patternCanvas, 'repeat');
    };
    
    gridPatternRef.current = createGridPattern();
    
    // Funkcja do przyciemniania koloru
    const darkenColor = (color, percent) => {
      // Jeśli kolor jest w formacie hsl
      if (color.startsWith('hsl')) {
        const match = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
        if (match) {
          const h = parseInt(match[1]);
          const s = parseInt(match[2]);
          const l = Math.max(0, parseInt(match[3]) - percent);
          return `hsl(${h}, ${s}%, ${l}%)`;
        }
      }
      // Fallback
      return color;
    };
    
    // Funkcja renderowania
    const render = (timestamp) => {
      // Białe tło
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      if (!playerView || !playerView.player) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      
      const { player, players, food, gameState } = playerView;
      
      // Dynamiczny zoom bazowany na rozmiarze gracza i okna
      const screenSize = Math.min(canvas.width, canvas.height);
      const baseZoom = screenSize / 800;
      const playerZoom = Math.max(0.8, Math.min(1.5, 100 / (player.radius * 0.3 + 50)));
      const zoomLevel = baseZoom * playerZoom;
      
      // Oblicz przesunięcie kamery
      const cameraX = player.x - canvas.width / 2 / zoomLevel;
      const cameraY = player.y - canvas.height / 2 / zoomLevel;
      
      // Zapisz stan kontekstu
      ctx.save();
      
      // Zastosuj zoom
      ctx.scale(zoomLevel, zoomLevel);
      
      // Przesuń canvas względem gracza
      ctx.translate(-cameraX, -cameraY);
      
      // Rysuj tło z siatką
      if (gridPatternRef.current) {
        ctx.fillStyle = gridPatternRef.current;
        ctx.fillRect(
          Math.floor(cameraX / 50) * 50,
          Math.floor(cameraY / 50) * 50,
          (canvas.width / zoomLevel) + 100,
          (canvas.height / zoomLevel) + 100
        );
      }
      
      // Rysuj granice mapy
      if (gameState?.mapSize) {
        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 5;
        ctx.strokeRect(0, 0, gameState.mapSize, gameState.mapSize);
      }
      
      // Rysuj jedzenie
      food.forEach(f => {
        // Cień
        ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
        ctx.shadowBlur = 5;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
        
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
        ctx.fill();
        
        // Reset cienia
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      });
      
      // Rysuj graczy - sortuj według rozmiaru (mniejsze najpierw, większe na wierzchu)
      const sortedPlayers = [...players].sort((a, b) => a.radius - b.radius);
      
      sortedPlayers.forEach(p => {
        // Sprawdź czy gracz jest w niebezpieczeństwie
        let inDanger = false;
        if (p.isMe && player.isAlive) {
          players.forEach(other => {
            if (other.id !== p.id && other.radius > p.radius * 1.1) {
              const dx = other.x - p.x;
              const dy = other.y - p.y;
              const distance = Math.sqrt(dx * dx + dy * dy);
              if (distance < other.radius + p.radius) {
                inDanger = true;
              }
            }
          });
        }
        
        // Cień gracza
        ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 3;
        ctx.shadowOffsetY = 3;
        
        // Ciało gracza
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        
        // Boost effect
        if (p.isBoosting) {
          ctx.strokeStyle = '#FFD700';
          ctx.lineWidth = 3;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius + 5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        
        // Obramowanie
        const borderColor = darkenColor(p.color, 20);
        if (inDanger) {
          ctx.strokeStyle = '#FF0000';
          ctx.lineWidth = 5;
          ctx.setLineDash([10, 5]);
        } else {
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = p.isMe ? 3 : 2;
          ctx.setLineDash([]);
        }
        ctx.stroke();
        
        // Reset cienia
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        
        // Nazwa gracza
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `${Math.max(12, p.radius / 4)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.lineWidth = 3;
        ctx.strokeText(p.nickname || 'Player', p.x, p.y - p.radius / 6);
        ctx.fillText(p.nickname || 'Player', p.x, p.y - p.radius / 6);
        
        // Wartość SOL gracza
        if (p.solDisplay) {
          ctx.font = `${Math.max(10, p.radius / 6)}px Arial`;
          ctx.fillStyle = '#FFFFFF';
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.lineWidth = 2;
          const solText = `${p.solDisplay} SOL`;
          ctx.strokeText(solText, p.x, p.y + p.radius / 3);
          ctx.fillText(solText, p.x, p.y + p.radius / 3);
        }
      });
      
      // Przywróć stan kontekstu
      ctx.restore();
      
      // Rysuj miniaturkę mapy
      drawMinimap(ctx, canvas, player, gameState, sortedPlayers);
      
      animationRef.current = requestAnimationFrame(render);
    };
    
    // Funkcja rysowania minimapy
    const drawMinimap = (ctx, canvas, player, gameState, players) => {
      if (!gameState?.mapSize) return;
      
      const minimapSize = 200;
      const minimapPadding = 20;
      const minimapX = canvas.width - minimapSize - minimapPadding;
      const minimapY = canvas.height - minimapSize - minimapPadding;
      
      // Tło minimapy
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.fillRect(minimapX, minimapY, minimapSize, minimapSize);
      
      // Obramowanie
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.strokeRect(minimapX, minimapY, minimapSize, minimapSize);
      
      // Skala
      const scale = minimapSize / gameState.mapSize;
      
      // Rysuj wszystkich graczy na minimapie
      players.forEach(p => {
        const playerMinimapX = minimapX + p.x * scale;
        const playerMinimapY = minimapY + p.y * scale;
        const playerMinimapRadius = Math.max(2, p.radius * scale);
        
        ctx.fillStyle = p.isMe ? '#FFD700' : p.color;
        ctx.beginPath();
        ctx.arc(playerMinimapX, playerMinimapY, playerMinimapRadius, 0, Math.PI * 2);
        ctx.fill();
      });
      
      // Obszar widoczny
      const viewSize = 1000 * scale;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        minimapX + player.x * scale - viewSize / 2,
        minimapY + player.y * scale - viewSize / 2,
        viewSize,
        viewSize
      );
    };
    
    // Rozpocznij renderowanie
    render();
    
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [playerView, ref]);
  
  return (
    <canvas
      ref={ref}
      className="game-canvas"
      onMouseMove={onMouseMove}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
});

Canvas.displayName = 'Canvas';

export default Canvas;