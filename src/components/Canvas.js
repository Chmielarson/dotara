// src/components/Canvas.js
import React, { useRef, useEffect, forwardRef, useState } from 'react';

const Canvas = forwardRef(({ playerView, onMouseMove }, ref) => {
  const [fps, setFps] = useState(0);
  const frameCount = useRef(0);
  const lastTime = useRef(Date.now());
  const animationFrameId = useRef();
  const interpolatedPlayers = useRef(new Map());
  
  useEffect(() => {
    if (!ref.current) return;
    
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Resize canvas
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // Interpolation for smooth movement
    const interpolatePosition = (current, target, factor = 0.15) => {
      return {
        x: current.x + (target.x - current.x) * factor,
        y: current.y + (target.y - current.y) * factor
      };
    };
    
    // Main render function
    const render = () => {
      frameCount.current++;
      
      // Calculate FPS
      const now = Date.now();
      if (now - lastTime.current >= 1000) {
        setFps(frameCount.current);
        frameCount.current = 0;
        lastTime.current = now;
      }
      
      // Clear canvas
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      if (!playerView || !playerView.player) {
        ctx.fillStyle = '#000000';
        ctx.font = '20px Arial';
        ctx.fillText('Waiting for player data...', 100, 100);
        animationFrameId.current = requestAnimationFrame(render);
        return;
      }
      
      const { player, players, food, gameState } = playerView;
      
      // Update interpolated positions when new data arrives
      if (players) {
        // Clear existing interpolated players that are no longer in view
        const currentIds = new Set(players.map(p => p.id));
        for (const [id] of interpolatedPlayers.current) {
          if (!currentIds.has(id)) {
            interpolatedPlayers.current.delete(id);
          }
        }
        
        // Update or create interpolated positions
        players.forEach(p => {
          const existing = interpolatedPlayers.current.get(p.id);
          if (!existing) {
            interpolatedPlayers.current.set(p.id, {
              x: p.x,
              y: p.y,
              targetX: p.x,
              targetY: p.y,
              radius: p.radius,
              color: p.color,
              nickname: p.nickname,
              mass: p.mass,
              isMe: p.isMe,
              isBoosting: p.isBoosting,
              solDisplay: p.solDisplay
            });
          } else {
            existing.targetX = p.x;
            existing.targetY = p.y;
            existing.radius = p.radius;
            existing.mass = p.mass;
            existing.isBoosting = p.isBoosting;
            existing.solDisplay = p.solDisplay;
            existing.color = p.color;
            existing.nickname = p.nickname;
            existing.isMe = p.isMe;
          }
        });
        
        // Interpolate positions
        for (const [id, interpolated] of interpolatedPlayers.current) {
          const pos = interpolatePosition(
            { x: interpolated.x, y: interpolated.y },
            { x: interpolated.targetX, y: interpolated.targetY }
          );
          interpolated.x = pos.x;
          interpolated.y = pos.y;
        }
      }
      
      // Find interpolated position for camera (our player)
      let cameraX = player.x - canvas.width / 2;
      let cameraY = player.y - canvas.height / 2;
      
      // Find our interpolated player for smooth camera movement
      for (const [id, p] of interpolatedPlayers.current) {
        if (p.isMe) {
          cameraX = p.x - canvas.width / 2;
          cameraY = p.y - canvas.height / 2;
          break;
        }
      }
      
      ctx.save();
      ctx.translate(-cameraX, -cameraY);
      
      // Draw grid background
      ctx.strokeStyle = '#f0f0f0';
      ctx.lineWidth = 1;
      const gridSize = 50;
      const startX = Math.floor(cameraX / gridSize) * gridSize;
      const startY = Math.floor(cameraY / gridSize) * gridSize;
      const endX = startX + canvas.width + gridSize;
      const endY = startY + canvas.height + gridSize;
      
      for (let x = startX; x < endX; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
        ctx.stroke();
      }
      
      for (let y = startY; y < endY; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
        ctx.stroke();
      }
      
      // Draw map border
      if (gameState && gameState.mapSize) {
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 5;
        ctx.strokeRect(0, 0, gameState.mapSize, gameState.mapSize);
      }
      
      // Draw food with slight pulsing animation
      const foodPulse = Math.sin(now * 0.003) * 0.1 + 1;
      if (food && food.length > 0) {
        food.forEach(f => {
          ctx.fillStyle = f.color || '#FF6B6B';
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.radius * foodPulse, 0, Math.PI * 2);
          ctx.fill();
          
          // Add slight glow effect
          ctx.shadowBlur = 5;
          ctx.shadowColor = f.color || '#FF6B6B';
          ctx.fill();
          ctx.shadowBlur = 0;
        });
      }
      
      // Draw all players
      for (const [id, p] of interpolatedPlayers.current) {
        // Draw player shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.beginPath();
        ctx.arc(p.x + 3, p.y + 3, p.radius, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw player body
        ctx.fillStyle = p.color || '#0095DD';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw boost effect
        if (p.isBoosting) {
          ctx.strokeStyle = '#FFD700';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius + 5, 0, Math.PI * 2);
          ctx.stroke();
        }
        
        // Draw border for own player
        if (p.isMe) {
          ctx.strokeStyle = '#FFD700';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius + 2, 0, Math.PI * 2);
          ctx.stroke();
        }
        
        // Draw player name
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3;
        ctx.font = `${Math.max(14, p.radius / 4)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const name = p.nickname || 'Player';
        ctx.strokeText(name, p.x, p.y - 5);
        ctx.fillText(name, p.x, p.y - 5);
        
        // Draw mass/SOL value
        const valueText = p.solDisplay ? `${p.solDisplay}` : `${Math.floor(p.mass)}`;
        ctx.font = `${Math.max(12, p.radius / 5)}px Arial`;
        ctx.strokeText(valueText, p.x, p.y + p.radius / 3);
        ctx.fillText(valueText, p.x, p.y + p.radius / 3);
      }
      
      ctx.restore();
      
      // Draw minimap
      const minimapSize = 150;
      const minimapMargin = 20;
      const minimapX = canvas.width - minimapSize - minimapMargin;
      const minimapY = canvas.height - minimapSize - minimapMargin;
      
      // Minimap background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(minimapX, minimapY, minimapSize, minimapSize);
      
      // Minimap border
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.strokeRect(minimapX, minimapY, minimapSize, minimapSize);
      
      // Draw players on minimap
      if (gameState && gameState.mapSize) {
        const scale = minimapSize / gameState.mapSize;
        
        // Draw all players as dots
        for (const [id, p] of interpolatedPlayers.current) {
          const dotX = minimapX + p.x * scale;
          const dotY = minimapY + p.y * scale;
          const dotSize = Math.max(2, p.radius * scale);
          
          ctx.fillStyle = p.isMe ? '#FFD700' : '#FF0000';
          ctx.beginPath();
          ctx.arc(dotX, dotY, dotSize, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      
      // Draw HUD
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(10, 10, 200, 100);
      
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '14px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(`FPS: ${fps}`, 20, 30);
      ctx.fillText(`Position: ${Math.floor(player.x)}, ${Math.floor(player.y)}`, 20, 50);
      ctx.fillText(`Mass: ${Math.floor(player.mass)}`, 20, 70);
      ctx.fillText(`Value: ${(player.solValue / 1000000000).toFixed(4)} SOL`, 20, 90);
      
      // Debug info
      if (now % 1000 < 16) {
        console.log('Canvas render:', {
          playerPos: `${Math.floor(player.x)}, ${Math.floor(player.y)}`,
          cameraPos: `${Math.floor(cameraX)}, ${Math.floor(cameraY)}`,
          playersCount: interpolatedPlayers.current.size,
          foodCount: food ? food.length : 0
        });
      }
      
      // Continue animation
      animationFrameId.current = requestAnimationFrame(render);
    };
    
    // Start render loop
    render();
    
    // Cleanup
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [playerView]);
  
  return (
    <canvas
      ref={ref}
      onMouseMove={onMouseMove}
      style={{ 
        display: 'block',
        cursor: 'crosshair',
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%'
      }}
    />
  );
});

Canvas.displayName = 'Canvas';

export default Canvas;