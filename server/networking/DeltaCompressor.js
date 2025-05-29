// server/networking/DeltaCompressor.js
class DeltaCompressor {
  constructor() {
    this.lastStates = new Map(); // playerAddress -> lastView
    this.compressionStats = {
      totalSent: 0,
      totalCompressed: 0,
      compressionRatio: 0
    };
  }
  
  computeDelta(playerAddress, currentView) {
    const lastState = this.lastStates.get(playerAddress);
    
    // Jeśli nie ma poprzedniego stanu, wyślij pełny widok
    if (!lastState) {
      this.lastStates.set(playerAddress, this.deepClone(currentView));
      return {
        type: 'full',
        data: currentView
      };
    }
    
    const delta = {
      type: 'delta',
      timestamp: Date.now(),
      player: null,
      entities: {
        added: [],
        updated: [],
        removed: []
      },
      food: {
        added: [],
        removed: []
      },
      leaderboard: null,
      gameState: null
    };
    
    // Sprawdź zmiany w danych gracza
    if (this.hasPlayerChanged(lastState.player, currentView.player)) {
      delta.player = this.getPlayerDelta(lastState.player, currentView.player);
    }
    
    // Sprawdź zmiany w graczach
    const lastPlayers = new Map((lastState.players || []).map(p => [p.id, p]));
    const currentPlayers = new Map(currentView.players.map(p => [p.id, p]));
    
    // Nowi gracze
    for (const [id, player] of currentPlayers) {
      if (!lastPlayers.has(id)) {
        delta.entities.added.push(player);
      } else {
        const changes = this.getEntityDelta(lastPlayers.get(id), player);
        if (changes) {
          delta.entities.updated.push({ id, ...changes });
        }
      }
    }
    
    // Usunięci gracze
    for (const id of lastPlayers.keys()) {
      if (!currentPlayers.has(id)) {
        delta.entities.removed.push(id);
      }
    }
    
    // Sprawdź zmiany w jedzeniu (uproszczone - tylko dodane/usunięte)
    const lastFood = new Set((lastState.food || []).map(f => f.id));
    const currentFood = new Set(currentView.food.map(f => f.id));
    
    // Nowe jedzenie
    for (const food of currentView.food) {
      if (!lastFood.has(food.id)) {
        delta.food.added.push(food);
      }
    }
    
    // Usunięte jedzenie
    for (const foodId of lastFood) {
      if (!currentFood.has(foodId)) {
        delta.food.removed.push(foodId);
      }
    }
    
    // Sprawdź zmiany w leaderboardzie
    if (this.hasLeaderboardChanged(lastState.leaderboard, currentView.leaderboard)) {
      delta.leaderboard = currentView.leaderboard;
    }
    
    // Sprawdź zmiany w game state (tylko kluczowe pola)
    if (this.hasGameStateChanged(lastState.gameState, currentView.gameState)) {
      delta.gameState = {
        playerCount: currentView.gameState.playerCount,
        totalSolDisplay: currentView.gameState.totalSolDisplay,
        roomId: currentView.gameState.roomId
      };
    }
    
    // Zapisz obecny stan
    this.lastStates.set(playerAddress, this.deepClone(currentView));
    
    // Statystyki kompresji
    this.updateCompressionStats(currentView, delta);
    
    // Jeśli delta jest pusta, nie wysyłaj
    if (!this.isDeltaSignificant(delta)) {
      return null;
    }
    
    return delta;
  }
  
  hasPlayerChanged(oldPlayer, newPlayer) {
    if (!oldPlayer || !newPlayer) return true;
    
    const keysToCheck = ['x', 'y', 'radius', 'mass', 'isAlive', 'isBoosting', 
                         'solValue', 'canCashOut', 'combatCooldownRemaining'];
    
    for (const key of keysToCheck) {
      if (oldPlayer[key] !== newPlayer[key]) {
        return true;
      }
    }
    
    return false;
  }
  
  getPlayerDelta(oldPlayer, newPlayer) {
    const delta = {};
    const keysToCheck = ['x', 'y', 'radius', 'mass', 'isAlive', 'isBoosting', 
                         'solValue', 'canCashOut', 'combatCooldownRemaining'];
    
    for (const key of keysToCheck) {
      if (oldPlayer[key] !== newPlayer[key]) {
        delta[key] = newPlayer[key];
      }
    }
    
    return delta;
  }
  
  getEntityDelta(oldEntity, newEntity) {
    const delta = {};
    let hasChanges = false;
    
    const keysToCheck = ['x', 'y', 'radius', 'mass', 'color', 'isBoosting'];
    
    for (const key of keysToCheck) {
      if (oldEntity[key] !== newEntity[key]) {
        delta[key] = newEntity[key];
        hasChanges = true;
      }
    }
    
    return hasChanges ? delta : null;
  }
  
  hasLeaderboardChanged(oldBoard, newBoard) {
    if (!oldBoard || !newBoard) return true;
    if (oldBoard.length !== newBoard.length) return true;
    
    for (let i = 0; i < oldBoard.length; i++) {
      if (oldBoard[i].address !== newBoard[i].address ||
          oldBoard[i].solValue !== newBoard[i].solValue) {
        return true;
      }
    }
    
    return false;
  }
  
  hasGameStateChanged(oldState, newState) {
    if (!oldState || !newState) return true;
    
    return oldState.playerCount !== newState.playerCount ||
           oldState.totalSolDisplay !== newState.totalSolDisplay;
  }
  
  isDeltaSignificant(delta) {
    if (delta.type === 'full') return true;
    
    return delta.player !== null ||
           delta.entities.added.length > 0 ||
           delta.entities.updated.length > 0 ||
           delta.entities.removed.length > 0 ||
           delta.food.added.length > 0 ||
           delta.food.removed.length > 0 ||
           delta.leaderboard !== null ||
           delta.gameState !== null;
  }
  
  deepClone(obj) {
    // Szybkie klonowanie dla naszych struktur danych
    return JSON.parse(JSON.stringify(obj));
  }
  
  updateCompressionStats(fullView, delta) {
    const fullSize = JSON.stringify(fullView).length;
    const deltaSize = JSON.stringify(delta).length;
    
    this.compressionStats.totalSent += deltaSize;
    this.compressionStats.totalCompressed += fullSize - deltaSize;
    this.compressionStats.compressionRatio = 
      (this.compressionStats.totalCompressed / (this.compressionStats.totalSent + this.compressionStats.totalCompressed)) * 100;
  }
  
  getStats() {
    return this.compressionStats;
  }
  
  clearPlayerState(playerAddress) {
    this.lastStates.delete(playerAddress);
  }
}

module.exports = DeltaCompressor;