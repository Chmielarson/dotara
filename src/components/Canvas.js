// src/components/Canvas.js
import React, { useRef, useEffect, forwardRef, useState } from 'react';

const Canvas = forwardRef(({ playerView, onMouseMove }, ref) => {
  const [fps, setFps] = useState(0);
  const frameCount = useRef(0);
  const lastTime = useRef(Date.now());
  
  useEffect(() => {
    if (!ref.current) return;
    
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    let animationId;
    
    // Resize canvas
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
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
      } else {
        const { player, players, food, gameState } = playerView;
        
        // Calculate camera
        const zoom = 1;
        const cameraX = player.x - canvas.width / 2;
        const cameraY = player.y - canvas.height / 2;
        
        ctx.save();
        ctx.translate(-cameraX, -cameraY);
        
        // Draw grid
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
        
        // Draw food
        ctx.fillStyle = '#FF0000';
        food.forEach(f => {
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
          ctx.fill();
        });
        
        // Draw players
        players.forEach(p => {
          // Player body
          ctx.fillStyle = p.color || '#0000FF';
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.fill();
          
          // Player name
          ctx.fillStyle = '#FFFFFF';
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 3;
          ctx.font = '14px Arial';
          ctx.textAlign = 'center';
          ctx.strokeText(p.nickname || 'Player', p.x, p.y);
          ctx.fillText(p.nickname || 'Player', p.x, p.y);
          
          // Mass
          ctx.font = '12px Arial';
          ctx.strokeText(Math.floor(p.mass), p.x, p.y + 20);
          ctx.fillText(Math.floor(p.mass), p.x, p.y + 20);
        });
        
        ctx.restore();
        
        // Draw HUD
        ctx.fillStyle = '#000000';
        ctx.font = '16px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(`FPS: ${fps}`, 10, 30);
        ctx.fillText(`Pos: ${Math.floor(player.x)}, ${Math.floor(player.y)}`, 10, 50);
        ctx.fillText(`Mass: ${Math.floor(player.mass)}`, 10, 70);
      }
      
      animationId = requestAnimationFrame(render);
    };
    
    // Start render loop
    render();
    
    // Cleanup
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [playerView]);
  
  return (
    <canvas
      ref={ref}
      onMouseMove={onMouseMove}
      style={{ 
        display: 'block',
        cursor: 'crosshair'
      }}
    />
  );
});

Canvas.displayName = 'Canvas';

export default Canvas;