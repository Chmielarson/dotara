// src/components/CreateGame.js
import React, { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { createRoom } from '../utils/SolanaTransactions';
import './CreateGame.css';

export default function CreateGame({ onBack, onRoomCreated }) {
  const wallet = useWallet();
  const { publicKey } = wallet;
  
  const [formData, setFormData] = useState({
    maxPlayers: 10,
    entryFee: 0.1,
    mapSize: 3000,
    gameDuration: 10
  });
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'maxPlayers' || name === 'mapSize' || name === 'gameDuration' 
        ? parseInt(value) 
        : parseFloat(value)
    }));
  };
  
  const handleSubmit = async () => {
    if (!publicKey) {
      setError('Connect wallet to create a room');
      return;
    }
    
    // Validation
    if (formData.maxPlayers < 2 || formData.maxPlayers > 20) {
      setError('Number of players must be between 2 and 20');
      return;
    }
    
    if (formData.entryFee < 0.01 || formData.entryFee > 10) {
      setError('Entry fee must be between 0.01 and 10 SOL');
      return;
    }
    
    if (formData.mapSize < 1000 || formData.mapSize > 10000) {
      setError('Map size must be between 1000 and 10000');
      return;
    }
    
    if (formData.gameDuration < 5 || formData.gameDuration > 60) {
      setError('Game time must be between 5 and 60 minutes');
      return;
    }
    
    try {
      setIsCreating(true);
      setError('');
      
      const roomId = await createRoom(
        formData.maxPlayers,
        formData.entryFee,
        formData.mapSize,
        formData.gameDuration,
        wallet
      );
      
      onRoomCreated(roomId);
    } catch (error) {
      console.error('Error creating room:', error);
      setError(`Error creating room: ${error.message}`);
    } finally {
      setIsCreating(false);
    }
  };
  
  const calculatePrize = () => {
    const total = formData.entryFee * formData.maxPlayers;
    const platformFee = total * 0.05;
    const winnerPrize = total - platformFee;
    return { total, platformFee, winnerPrize };
  };
  
  const prize = calculatePrize();
  
  return (
    <div className="create-game">
      <h2>Create new game</h2>
      
      <div className="form-container">
        <div className="form-group">
          <label>
            Maximum players
            <input
              type="number"
              name="maxPlayers"
              value={formData.maxPlayers}
              onChange={handleChange}
              min="2"
              max="20"
              required
            />
            <span className="hint">From 2 to 20 players</span>
          </label>
        </div>
        
        <div className="form-group">
          <label>
            Entry fee (SOL)
            <input
              type="number"
              name="entryFee"
              value={formData.entryFee}
              onChange={handleChange}
              min="0.01"
              max="10"
              step="0.01"
              required
            />
            <span className="hint">From 0.01 to 10 SOL</span>
          </label>
        </div>
        
        <div className="form-group">
          <label>
            Map size
            <input
              type="number"
              name="mapSize"
              value={formData.mapSize}
              onChange={handleChange}
              min="1000"
              max="10000"
              step="500"
              required
            />
            <span className="hint">From 1000 to 10000 units</span>
          </label>
        </div>
        
        <div className="form-group">
          <label>
            Game time (minutes)
            <input
              type="number"
              name="gameDuration"
              value={formData.gameDuration}
              onChange={handleChange}
              min="5"
              max="60"
              required
            />
            <span className="hint">From 5 to 60 minutes</span>
          </label>
        </div>
        
        <div className="prize-info">
          <h3>Prize information</h3>
          <div className="prize-row">
            <span>Total pool:</span>
            <span>{prize.total.toFixed(2)} SOL</span>
          </div>
          <div className="prize-row">
            <span>Platform fee (5%):</span>
            <span>{prize.platformFee.toFixed(2)} SOL</span>
          </div>
          <div className="prize-row highlight">
            <span>Winner prize:</span>
            <span>{prize.winnerPrize.toFixed(2)} SOL</span>
          </div>
        </div>
        
        {error && (
          <div className="error-message">
            {error}
          </div>
        )}
        
        <div className="form-actions">
          <button type="button" onClick={onBack} className="cancel-btn">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={isCreating} className="submit-btn">
            {isCreating ? 'Creating...' : 'Create room'}
          </button>
        </div>
      </div>
    </div>
  );
}