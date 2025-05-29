// src/components/Canvas.js
import React, { useRef, useEffect, forwardRef, useMemo } from 'react';
import { InterpolationManager } from './InterpolationManager';

const Canvas = forwardRef(({ playerView, onMouseMove }, ref) => {
  const animationRef = useRef();
  const gridPatternRef = useRef();
  const lastFrameTime = useRef(Date.now());
  const frameCount = useRef(0);
  const fps = useRef(0);
  
  // Interpolation manager dla płynnego ruchu
  const interpolationManager = useMemo(() => new InterpolationManager(100), []);
  
  useEffect(() => {
    if (!ref.current) return;
    
    const canvas = ref.current;
    const ctx = canvas.getContext('2d', {
      alpha: false, // Nie potrzebujemy przezroczystości
      desynchronized: true // Lepsze performance
    });
    
    // Włącz image smoothing dla lepszej jakości
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    // Ustaw rozmiar canvas
    const resizeCanvas = () => {
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * pixelRatio;
      canvas.height = window.innerHeight * pixelRatio;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.scale(pixelRatio, pixelRatio);
    };
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // Stwórz wzór siatki (cache)
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
    
    // Cache dla kolorów
    const colorCache = new Map();
    
    // Funkcja do przyciemniania koloru (cache)
    const darkenColor = (color, percent) => {
      const cacheKey = `${color}-${percent}`;
      if (colorCache.has(cacheKey)) {
        return colorCache.get(cacheKey);
      }
      
      let result = color;
      
      // Jeśli kolor jest w formacie hsl
      if (color.startsWith('hsl')) {
        const match = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
        if (match) {
          const h = parseInt(match[1]);
          const s = parseInt(match[2]);
          const l = Math.max(0, parseInt(match[3]) - percent);
          result = `hsl(${h}, ${s}%, ${l}%)`;
        }
      }
      
      colorCache.set(cacheKey, result);
      return result;
    };
    
    // Optymalizowana funkcja renderowania
    const render = (timestamp) => {
      // FPS counter
      frameCount.current++;
      const currentTime = Date.now();
      const timeDelta = currentTime - lastFrameTime.current;
      
      if (timeDelta >= 1000) {
        fps.current = Math.round((frameCount.current * 1000) / timeDelta);
        frameCount.current = 0;
        lastFrameTime.current = currentTime;
      }
      
      // Clear canvas
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      if (!playerView || !playerView.player) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      
      const { player, players, food, gameState } = playerView;
      
      // Aktualizuj interpolation manager
      if (players) {
        for (const p of players) {
          interpolationManager.updateEntity(p.id, p);
        }
      }
      
      // Pobierz interpolowane pozycje
      const interpolatedPlayers = interpolationManager.getAllInterpolatedStates();
      
      // Dynamiczny zoom
      const screenSize = Math.min(canvas.width, canvas.height);
      const baseZoom = screenSize / 800;
      const playerZoom = Math.max(0.8, Math.min(1.5, 100 / (player.radius * 0.3 + 50)));
      const zoomLevel = baseZoom * playerZoom;
      
      // Oblicz przesunięcie kamery
      const cameraX = player.x - canvas.width / 2 / zoomLevel;
      const cameraY = player.y - canvas.height / 2 / zoomLevel;
      
      // Zapisz stan kontekstu
      ctx.save();
      
      // Zastosuj zoom i translację
      ctx.scale(zoomLevel, zoomLevel);
      ctx.translate(-cameraX, -cameraY);
      
      // Rysuj tło z siatką (używaj cached pattern)
      if (gridPatternRef.current) {
        ctx.fillStyle = gridPatternRef.current;
        const gridStartX = Math.floor(cameraX / 50) * 50;
        const gridStartY = Math.floor(cameraY / 50) * 50;
        ctx.fillRect(
          gridStartX,
          gridStartY,
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
      
      // Rysuj bariery stref (jeśli są)
      if (playerView.barriers) {
        playerView.barriers.forEach(barrier => {
          ctx.strokeStyle = barrier.canPass ? 'rgba(0, 255, 0, 0.3)' : 'rgba(255, 0, 0, 0.5)';
          ctx.lineWidth = 5;
          ctx.setLineDash([10, 10]);
          
          ctx.beginPath();
          if (barrier.type === 'horizontal') {
            ctx.moveTo(barrier.x, barrier.y);
            ctx.lineTo(barrier.x + barrier.width, barrier.y);
          } else {
            ctx.moveTo(barrier.x, barrier.y);
            ctx.lineTo(barrier.x, barrier.y + barrier.height);
          }
          ctx.stroke();
          ctx.setLineDash([]);
        });
      }
      
      // Batch render jedzenia
      ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
      
      food.forEach(f => {
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
        ctx.fill();
      });
      
      // Reset shadow
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      
      // Sortuj graczy według rozmiaru
      const sortedPlayers = Array.from(interpolatedPlayers.values())
        .sort((a, b) => a.radius - b.radius);
      
      // Batch render graczy
      sortedPlayers.forEach(p => {
        // Sprawdź czy gracz jest w niebezpieczeństwie
        let inDanger = false;
        if (p.isMe && player.isAlive) {
          for (const other of interpolatedPlayers.values()) {
            if (other.id !== p.id && other.radius > p.radius * 1.1) {
              const dx = other.x - p.x;
              const dy = other.y - p.y;
              const distance = Math.sqrt(dx * dx + dy * dy);
              if (distance < other.radius + p.radius) {
                inDanger = true;
                break;
              }
            }
          }
        }
        
        // Shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 3;
        ctx.shadowOffsetY = 3;
        
        // Body
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
        
        // Border
        const borderColor = darkenColor(p.color, 20);
        ctx.strokeStyle = inDanger ? '#FF0000' : borderColor;
        ctx.lineWidth = p.isMe ? 3 : 2;
        if (inDanger) {
          ctx.setLineDash([10, 5]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        
        // Text (nickname + SOL)
        const fontSize = Math.max(12, p.radius / 4);
        ctx.font = `${fontSize}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.lineWidth = 3;
        
        // Nickname
        ctx.strokeText(p.nickname || 'Player', p.x, p.y - p.radius / 6);
        ctx.fillText(p.nickname || 'Player', p.x, p.y - p.radius / 6);
        
        // SOL value
        if (p.solDisplay) {
          ctx.font = `${Math.max(10, p.radius / 6)}px Arial`;
          const solText = `${p.solDisplay} SOL`;
          ctx.strokeText(solText, p.x, p.y + p.radius / 3);
          ctx.fillText(solText, p.x, p.y + p.radius / 3);
        }
      });
      
      // Przywróć stan kontekstu
      ctx.restore();
      
      // Rysuj UI (minimap, FPS)
      drawMinimap(ctx, canvas, player, gameState, sortedPlayers);
      drawFPS(ctx, fps.current);
      
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
      
      // Rysuj strefy
      if (playerView?.zones) {
        const zoneSize = minimapSize / 2;
        
        // Zone colors
        ctx.fillStyle = 'rgba(205, 127, 50, 0.2)';
        ctx.fillRect(minimapX, minimapY, zoneSize, zoneSize);
        
        ctx.fillStyle = 'rgba(192, 192, 192, 0.2)';
        ctx.fillRect(minimapX + zoneSize, minimapY, zoneSize, zoneSize);
        
        ctx.fillStyle = 'rgba(255, 215, 0, 0.2)';
        ctx.fillRect(minimapX, minimapY + zoneSize, zoneSize, zoneSize);
        
        ctx.fillStyle = 'rgba(185, 242, 255, 0.2)';
        ctx.fillRect(minimapX + zoneSize, minimapY + zoneSize, zoneSize, zoneSize);
        
        // Zone borders
        ctx.strokeStyle = '#666666';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(minimapX + zoneSize, minimapY);
        ctx.lineTo(minimapX + zoneSize, minimapY + minimapSize);
        ctx.moveTo(minimapX, minimapY + zoneSize);
        ctx.lineTo(minimapX + minimapSize, minimapY + zoneSize);
        ctx.stroke();
      }
      
      // Border
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.strokeRect(minimapX, minimapY, minimapSize, minimapSize);
      
      // Scale
      const scale = minimapSize / gameState.mapSize;
      
      // Draw players on minimap
      players.forEach(p => {
        const playerMinimapX = minimapX + p.x * scale;
        const playerMinimapY = minimapY + p.y * scale;
        const playerMinimapRadius = Math.max(2, p.radius * scale);
        
        ctx.fillStyle = p.isMe ? '#FFD700' : p.color;
        ctx.beginPath();
        ctx.arc(playerMinimapX, playerMinimapY, playerMinimapRadius, 0, Math.PI * 2);
        ctx.fill();
        
        if (p.isMe) {
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      });
      
      // Viewport rect
      const viewSize = 1000 * scale;
      const viewX = minimapX + player.x * scale - viewSize / 2;
      const viewY = minimapY + player.y * scale - viewSize / 2;
      
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(viewX, viewY, viewSize, viewSize);
    };
    
    // Funkcja rysowania FPS
    const drawFPS = (ctx, currentFPS) => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(10, 10, 80, 30);
      
      ctx.fillStyle = currentFPS >= 50 ? '#00FF00' : currentFPS >= 30 ? '#FFFF00' : '#FF0000';
      ctx.font = '16px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(`FPS: ${currentFPS}`, 20, 30);
    };
    
    // Rozpocznij renderowanie
    render();
    
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      interpolationManager.clear();
    };
  }, [playerView, ref, interpolationManager]);
  
  return (
    <canvas
      ref={ref}
      className="game-canvas"
      onMouseMove={onMouseMove}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        cursor: 'crosshair',
        touchAction: 'none' // Disable touch scrolling
      }}
    />
  );
});

Canvas.displayName = 'Canvas';

export default Canvas;