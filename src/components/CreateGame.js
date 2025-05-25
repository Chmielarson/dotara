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
      setError('Połącz portfel, aby stworzyć pokój');
      return;
    }
    
    // Walidacja
    if (formData.maxPlayers < 2 || formData.maxPlayers > 20) {
      setError('Liczba graczy musi być między 2 a 20');
      return;
    }
    
    if (formData.entryFee < 0.01 || formData.entryFee > 10) {
      setError('Wpisowe musi być między 0.01 a 10 SOL');
      return;
    }
    
    if (formData.mapSize < 1000 || formData.mapSize > 10000) {
      setError('Rozmiar mapy musi być między 1000 a 10000');
      return;
    }
    
    if (formData.gameDuration < 5 || formData.gameDuration > 60) {
      setError('Czas gry musi być między 5 a 60 minut');
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
      setError(`Błąd tworzenia pokoju: ${error.message}`);
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
      <h2>Stwórz nową grę</h2>
      
      <div className="form-container">
        <div className="form-group">
          <label>
            Maksymalna liczba graczy
            <input
              type="number"
              name="maxPlayers"
              value={formData.maxPlayers}
              onChange={handleChange}
              min="2"
              max="20"
              required
            />
            <span className="hint">Od 2 do 20 graczy</span>
          </label>
        </div>
        
        <div className="form-group">
          <label>
            Wpisowe (SOL)
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
            <span className="hint">Od 0.01 do 10 SOL</span>
          </label>
        </div>
        
        <div className="form-group">
          <label>
            Rozmiar mapy
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
            <span className="hint">Od 1000 do 10000 jednostek</span>
          </label>
        </div>
        
        <div className="form-group">
          <label>
            Czas gry (minuty)
            <input
              type="number"
              name="gameDuration"
              value={formData.gameDuration}
              onChange={handleChange}
              min="5"
              max="60"
              required
            />
            <span className="hint">Od 5 do 60 minut</span>
          </label>
        </div>
        
        <div className="prize-info">
          <h3>Informacje o nagrodzie</h3>
          <div className="prize-row">
            <span>Całkowita pula:</span>
            <span>{prize.total.toFixed(2)} SOL</span>
          </div>
          <div className="prize-row">
            <span>Prowizja platformy (5%):</span>
            <span>{prize.platformFee.toFixed(2)} SOL</span>
          </div>
          <div className="prize-row highlight">
            <span>Nagroda dla zwycięzcy:</span>
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
            Anuluj
          </button>
          <button onClick={handleSubmit} disabled={isCreating} className="submit-btn">
            {isCreating ? 'Tworzenie...' : 'Stwórz pokój'}
          </button>
        </div>
      </div>
    </div>
  );
}