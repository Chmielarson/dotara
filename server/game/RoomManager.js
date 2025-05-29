// server/game/RoomManager.js
const GameEngine = require('./GameEngine');

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.playerRoomMap = new Map(); // playerAddress -> roomId
    this.maxPlayersPerRoom = 50;
    this.maxRooms = 20;
    this.roomStats = new Map(); // roomId -> stats
    
    console.log(`Initializing RoomManager with ${this.maxRooms} rooms (${this.maxPlayersPerRoom} players each)`);
    
    // Inicjalizuj pokoje
    for (let i = 1; i <= this.maxRooms; i++) {
      this.createRoom(i);
    }
  }
  
  createRoom(roomId) {
    const room = {
      id: roomId,
      engine: new GameEngine(),
      players: new Set(),
      lastActivity: Date.now(),
      created: Date.now()
    };
    
    // Skonfiguruj engine dla tego pokoju
    room.engine.roomId = roomId;
    room.engine.maxPlayers = this.maxPlayersPerRoom;
    
    // Ustaw callback dla blockchain updates
    room.engine.onPlayerEaten = (eaterAddress, eatenAddress, eatenValue) => {
      // Przekaż do głównego handlera
      if (this.onPlayerEaten) {
        this.onPlayerEaten(eaterAddress, eatenAddress, eatenValue);
      }
    };
    
    room.engine.start();
    this.rooms.set(roomId, room);
    
    // Inicjalizuj statystyki pokoju
    this.roomStats.set(roomId, {
      totalPlayers: 0,
      activePlayers: 0,
      totalSol: 0,
      created: Date.now()
    });
    
    console.log(`Room ${roomId} created and started`);
  }
  
  findBestRoom() {
    // Znajdź pokój z najmniejszą liczbą graczy ale nie pusty
    // Preferuj pokoje które już mają graczy (dla lepszej rozgrywki)
    let bestRoom = null;
    let bestScore = -1;
    
    for (const [roomId, room] of this.rooms) {
      if (room.players.size >= this.maxPlayersPerRoom) continue;
      
      // Score: preferuj pokoje z graczami ale nie pełne
      // 0 graczy = score 0, 25 graczy = score 50, 49 graczy = score 2
      const fillRatio = room.players.size / this.maxPlayersPerRoom;
      let score = 0;
      
      if (room.players.size === 0) {
        score = 0; // Pusty pokój - najniższy priorytet
      } else if (fillRatio < 0.9) {
        score = room.players.size; // Im więcej graczy tym lepiej
      } else {
        score = 100 - room.players.size; // Prawie pełny - niski priorytet
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestRoom = room;
      }
    }
    
    // Jeśli nie znaleziono pokoju z graczami, znajdź pierwszy pusty
    if (!bestRoom) {
      for (const [roomId, room] of this.rooms) {
        if (room.players.size < this.maxPlayersPerRoom) {
          bestRoom = room;
          break;
        }
      }
    }
    
    return bestRoom;
  }
  
  assignPlayerToRoom(playerAddress, nickname, initialStake) {
    // Sprawdź czy gracz już jest w jakimś pokoju
    const existingRoomId = this.playerRoomMap.get(playerAddress);
    if (existingRoomId) {
      const existingRoom = this.rooms.get(existingRoomId);
      if (existingRoom && existingRoom.players.has(playerAddress)) {
        console.log(`Player ${playerAddress} already in room ${existingRoomId}`);
        return existingRoom;
      }
    }
    
    const room = this.findBestRoom();
    if (!room) {
      console.error('No available rooms!');
      return null;
    }
    
    // Dodaj gracza do pokoju
    room.players.add(playerAddress);
    this.playerRoomMap.set(playerAddress, room.id);
    room.lastActivity = Date.now();
    
    // Dodaj gracza do engine
    const player = room.engine.addPlayer(playerAddress, nickname, initialStake);
    
    // Aktualizuj statystyki
    this.updateRoomStats(room.id);
    
    console.log(`Player ${playerAddress} assigned to room ${room.id} (${room.players.size}/${this.maxPlayersPerRoom} players)`);
    
    return room;
  }
  
  removePlayerFromRoom(playerAddress, cashOut = false) {
    const roomId = this.playerRoomMap.get(playerAddress);
    if (!roomId) return null;
    
    const room = this.rooms.get(roomId);
    if (!room) return null;
    
    // Usuń z engine
    const result = room.engine.removePlayer(playerAddress, cashOut);
    
    // Usuń z room tracking
    room.players.delete(playerAddress);
    this.playerRoomMap.delete(playerAddress);
    room.lastActivity = Date.now();
    
    // Aktualizuj statystyki
    this.updateRoomStats(roomId);
    
    console.log(`Player ${playerAddress} removed from room ${roomId} (cashOut: ${cashOut})`);
    
    return result;
  }
  
  getPlayerRoom(playerAddress) {
    const roomId = this.playerRoomMap.get(playerAddress);
    return roomId ? this.rooms.get(roomId) : null;
  }
  
  getPlayerEngine(playerAddress) {
    const room = this.getPlayerRoom(playerAddress);
    return room ? room.engine : null;
  }
  
  updateRoomStats(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    
    const stats = room.engine.getGameState();
    this.roomStats.set(roomId, {
      totalPlayers: room.players.size,
      activePlayers: stats.playerCount,
      totalSol: stats.totalSolInGame,
      foodCount: stats.foodCount,
      updated: Date.now()
    });
  }
  
  getGlobalStats() {
    let totalPlayers = 0;
    let totalActivePlayers = 0;
    let totalSol = 0;
    let totalFood = 0;
    const roomsInfo = [];
    
    for (const [roomId, room] of this.rooms) {
      const stats = this.roomStats.get(roomId) || {};
      totalPlayers += room.players.size;
      totalActivePlayers += stats.activePlayers || 0;
      totalSol += stats.totalSol || 0;
      totalFood += stats.foodCount || 0;
      
      roomsInfo.push({
        id: roomId,
        players: room.players.size,
        maxPlayers: this.maxPlayersPerRoom,
        activePlayers: stats.activePlayers || 0,
        totalSol: (stats.totalSol || 0) / 1000000000, // Convert to SOL
        isFull: room.players.size >= this.maxPlayersPerRoom
      });
    }
    
    // Pobierz globalny leaderboard (top 10 ze wszystkich pokoi)
    const allPlayers = [];
    for (const [roomId, room] of this.rooms) {
      const leaderboard = room.engine.leaderboard || [];
      leaderboard.forEach(player => {
        allPlayers.push({
          ...player,
          roomId
        });
      });
    }
    
    // Sortuj globalnie i weź top 10
    const globalLeaderboard = allPlayers
      .sort((a, b) => b.solValue - a.solValue)
      .slice(0, 10)
      .map((player, index) => ({
        ...player,
        rank: index + 1
      }));
    
    return {
      totalRooms: this.rooms.size,
      totalPlayers,
      totalActivePlayers,
      totalSol,
      totalSolDisplay: (totalSol / 1000000000).toFixed(4),
      totalFood,
      rooms: roomsInfo,
      leaderboard: globalLeaderboard,
      averagePlayersPerRoom: (totalPlayers / this.rooms.size).toFixed(1),
      capacityUsed: ((totalPlayers / (this.maxRooms * this.maxPlayersPerRoom)) * 100).toFixed(1)
    };
  }
  
  // Broadcast do wszystkich graczy w pokoju
  broadcastToRoom(roomId, event, data) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    
    const playerSockets = [];
    for (const playerAddress of room.players) {
      // To będzie używane przez główny serwer
      playerSockets.push(playerAddress);
    }
    
    return playerSockets;
  }
  
  // Cleanup nieaktywnych pokoi (opcjonalne)
  cleanup() {
    const now = Date.now();
    const inactivityThreshold = 30 * 60 * 1000; // 30 minut
    
    for (const [roomId, room] of this.rooms) {
      if (room.players.size === 0 && 
          now - room.lastActivity > inactivityThreshold) {
        console.log(`Room ${roomId} inactive for 30 minutes, resetting...`);
        room.engine.stop();
        this.createRoom(roomId); // Recreate fresh room
      }
    }
  }
  
  // Uruchom periodic cleanup
  startCleanupTimer() {
    setInterval(() => {
      this.cleanup();
      // Aktualizuj statystyki wszystkich pokoi
      for (const [roomId] of this.rooms) {
        this.updateRoomStats(roomId);
      }
    }, 60000); // Co minutę
  }
  
  // Zatrzymaj wszystkie pokoje
  stopAll() {
    for (const [roomId, room] of this.rooms) {
      room.engine.stop();
      console.log(`Room ${roomId} stopped`);
    }
  }
}

module.exports = RoomManager;