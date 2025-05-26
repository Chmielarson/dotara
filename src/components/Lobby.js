// src/components/Lobby.js
import React, { useState, useEffect } from 'react';
import { getRooms, getRoomsUpdates } from '../utils/SolanaTransactions';
import './Lobby.css';

export default function Lobby({ onJoinRoom, onCreateRoom }) {
  const [rooms, setRooms] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, waiting, inprogress
  
  useEffect(() => {
    // Get initial room list
    const fetchRooms = async () => {
      try {
        const roomsData = await getRooms();
        setRooms(roomsData);
      } catch (error) {
        console.error('Error fetching rooms:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchRooms();
    
    // Listen for updates
    const unsubscribe = getRoomsUpdates((updatedRooms) => {
      setRooms(updatedRooms);
    });
    
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);
  
  const filteredRooms = rooms.filter(room => {
    if (filter === 'waiting') return !room.gameStarted;
    if (filter === 'inprogress') return room.gameStarted;
    return true;
  });
  
  const formatSOL = (amount) => {
    return amount.toFixed(2);
  };
  
  return (
    <div className="lobby">
      <div className="lobby-controls">
        <div className="filter-buttons">
          <button 
            className={filter === 'all' ? 'active' : ''}
            onClick={() => setFilter('all')}
          >
            All ({rooms.length})
          </button>
          <button 
            className={filter === 'waiting' ? 'active' : ''}
            onClick={() => setFilter('waiting')}
          >
            Waiting ({rooms.filter(r => !r.gameStarted).length})
          </button>
          <button 
            className={filter === 'inprogress' ? 'active' : ''}
            onClick={() => setFilter('inprogress')}
          >
            In progress ({rooms.filter(r => r.gameStarted).length})
          </button>
        </div>
        
        <button className="create-room-btn" onClick={onCreateRoom}>
          <span className="icon">+</span>
          Create new game
        </button>
      </div>
      
      {isLoading ? (
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading rooms...</p>
        </div>
      ) : filteredRooms.length === 0 ? (
        <div className="no-rooms">
          <p>No rooms available</p>
          <p>Create the first game!</p>
        </div>
      ) : (
        <div className="rooms-grid">
          {filteredRooms.map(room => (
            <div key={room.id} className={`room-card ${room.gameStarted ? 'in-progress' : ''}`}>
              <div className="room-header">
                <h3>Room #{room.id.substring(room.id.length - 8)}</h3>
                <span className={`status ${room.gameStarted ? 'started' : 'waiting'}`}>
                  {room.gameStarted ? 'In game' : 'Waiting'}
                </span>
              </div>
              
              <div className="room-info">
                <div className="info-row">
                  <span className="label">Players:</span>
                  <span className="value">{room.currentPlayers}/{room.maxPlayers}</span>
                </div>
                <div className="info-row">
                  <span className="label">Entry fee:</span>
                  <span className="value">{formatSOL(room.entryFee)} SOL</span>
                </div>
                <div className="info-row">
                  <span className="label">Prize pool:</span>
                  <span className="value highlight">{formatSOL(room.entryFee * room.currentPlayers)} SOL</span>
                </div>
                <div className="info-row">
                  <span className="label">Map:</span>
                  <span className="value">{room.mapSize}x{room.mapSize}</span>
                </div>
                <div className="info-row">
                  <span className="label">Game time:</span>
                  <span className="value">{room.gameDuration} min</span>
                </div>
              </div>
              
              <div className="room-players">
                <p className="players-label">Players in room:</p>
                <div className="players-list">
                  {room.players.map((player, index) => (
                    <div key={player} className="player-chip">
                      {player.substring(0, 4)}...{player.substring(player.length - 4)}
                      {index === 0 && <span className="creator-badge">👑</span>}
                    </div>
                  ))}
                </div>
              </div>
              
              <button
                className="join-btn"
                onClick={() => onJoinRoom(room.id)}
                disabled={room.gameStarted || room.currentPlayers >= room.maxPlayers}
              >
                {room.gameStarted ? 'Game in progress' : 
                 room.currentPlayers >= room.maxPlayers ? 'Full' : 
                 'Join'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}