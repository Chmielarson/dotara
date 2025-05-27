// server/game/GameEngine.js
const Player = require('./Player');
const Food = require('./Food');
const Physics = require('./Physics');

class GameEngine {
  constructor() {
    this.mapSize = 5000; // Większa mapa dla ciągłej gry
    this.maxFood = 500; // Więcej jedzenia
    this.players = new Map();
    this.food = new Map();
    this.physics = new Physics();
    this.isRunning = false;
    this.lastUpdate = Date.now();
    this.tickRate = 60; // 60 FPS
    this.gameLoop = null;
    this.leaderboard = [];
    
    // Statystyki globalne
    this.totalSolInGame = 0;
    this.totalPlayersJoined = 0;
    this.totalPlayersCashedOut = 0;
    
    console.log(`Global game engine created with map size ${this.mapSize}`);
    
    // Inicjalizuj jedzenie
    this.initializeFood();
  }
  
  initializeFood() {
    for (let i = 0; i < this.maxFood; i++) {
      this.spawnFood();
    }
  }
  
  spawnFood() {
    const food = new Food(
      Math.random() * this.mapSize,
      Math.random() * this.mapSize,
      Math.random() * 10 + 5 // masa 5-15
    );
    this.food.set(food.id, food);
  }
  
  addPlayer(playerAddress, nickname = null, initialStake = 0) {
    // Sprawdź czy gracz już istnieje
    let player = this.players.get(playerAddress);
    
    if (player && player.isAlive) {
      // Gracz już jest w grze i żyje
      return player;
    }
    
    // Losowa pozycja startowa z marginesem od krawędzi
    const margin = 200;
    const x = margin + Math.random() * (this.mapSize - 2 * margin);
    const y = margin + Math.random() * (this.mapSize - 2 * margin);
    
    if (player && !player.isAlive) {
      // Respawn istniejącego gracza
      player.respawn(x, y);
      console.log(`Player ${playerAddress} respawned with stake: ${initialStake}`);
    } else {
      // Nowy gracz
      player = new Player(playerAddress, x, y, nickname, initialStake);
      this.players.set(playerAddress, player);
      this.totalSolInGame += initialStake;
      this.totalPlayersJoined++;
      console.log(`Player ${playerAddress} joined with stake: ${initialStake} lamports`);
    }
    
    return player;
  }
  
  removePlayer(playerAddress, cashOut = false) {
    const player = this.players.get(playerAddress);
    if (!player) return null;
    
    if (cashOut) {
      // Gracz wypłaca i wychodzi
      this.totalSolInGame -= player.solValue;
      this.totalPlayersCashedOut++;
      this.players.delete(playerAddress);
      console.log(`Player ${playerAddress} cashed out with ${player.solValue} lamports`);
      return player;
    } else if (player.isAlive) {
      // Gracz został zjedzony - zostaje w grze jako martwy
      this.convertPlayerToFood(player);
      player.die();
      console.log(`Player ${playerAddress} was eaten`);
      return player;
    }
    
    return null;
  }
  
  convertPlayerToFood(player) {
    // Rozdziel tylko masę gracza na jedzenie (nie SOL!)
    const numFood = Math.min(Math.floor(player.mass / 20), 10);
    const foodMass = player.mass / numFood;
    
    for (let i = 0; i < numFood; i++) {
      const angle = (Math.PI * 2 * i) / numFood;
      const distance = player.radius + Math.random() * 50;
      
      const food = new Food(
        player.x + Math.cos(angle) * distance,
        player.y + Math.sin(angle) * distance,
        foodMass
      );
      this.food.set(food.id, food);
    }
  }
  
  updatePlayer(playerAddress, input) {
    const player = this.players.get(playerAddress);
    if (!player || !player.isAlive) return;
    
    // Upewnij się, że współrzędne są liczbami
    if (input.mouseX !== undefined && input.mouseY !== undefined) {
      const mouseX = parseFloat(input.mouseX);
      const mouseY = parseFloat(input.mouseY);
      
      if (!isNaN(mouseX) && !isNaN(mouseY)) {
        player.setTarget(mouseX, mouseY);
      } else {
        console.error(`Invalid mouse coordinates from ${playerAddress}: mouseX=${input.mouseX}, mouseY=${input.mouseY}`);
      }
    }
    
    // Obsługa podziału (space) - boost
    if (input.split && player.canSplit()) {
      player.split();
    }
    
    // Obsługa wyrzucania masy (W)
    if (input.eject && player.canEject()) {
      this.ejectMass(player);
    }
  }
  
  ejectMass(player) {
    if (player.mass < 35) return;
    
    const ejectMass = 15;
    player.mass -= ejectMass;
    player.updateRadius();
    
    const angle = Math.atan2(player.targetY - player.y, player.targetX - player.x);
    const distance = player.radius + 20;
    
    const food = new Food(
      player.x + Math.cos(angle) * distance,
      player.y + Math.sin(angle) * distance,
      ejectMass
    );
    
    // Nadaj prędkość wyrzuconej masie
    food.velocityX = Math.cos(angle) * 24;
    food.velocityY = Math.sin(angle) * 24;
    
    this.food.set(food.id, food);
  }
  
  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.lastUpdate = Date.now();
    
    // Główna pętla gry
    this.gameLoop = setInterval(() => {
      this.update();
    }, 1000 / this.tickRate);
    
    console.log('Global game engine started');
  }
  
  stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    if (this.gameLoop) {
      clearInterval(this.gameLoop);
      this.gameLoop = null;
    }
    
    console.log('Global game engine stopped');
  }
  
  update() {
    const now = Date.now();
    const deltaTime = (now - this.lastUpdate) / 1000;
    this.lastUpdate = now;
    
    // Aktualizuj pozycje graczy
    for (const player of this.players.values()) {
      if (player.isAlive) {
        player.update(deltaTime, this.mapSize);
      }
    }
    
    // Aktualizuj pozycje jedzenia
    for (const food of this.food.values()) {
      if (food.velocityX || food.velocityY) {
        food.x += food.velocityX * deltaTime * 60;
        food.y += food.velocityY * deltaTime * 60;
        
        // Tłumienie
        food.velocityX *= 0.95;
        food.velocityY *= 0.95;
        
        // Zatrzymaj jeśli prędkość jest bardzo mała
        if (Math.abs(food.velocityX) < 0.1) food.velocityX = 0;
        if (Math.abs(food.velocityY) < 0.1) food.velocityY = 0;
        
        // Granice mapy
        food.x = Math.max(0, Math.min(this.mapSize, food.x));
        food.y = Math.max(0, Math.min(this.mapSize, food.y));
      }
    }
    
    // Sprawdź kolizje
    this.checkCollisions();
    
    // Uzupełnij jedzenie
    while (this.food.size < this.maxFood) {
      this.spawnFood();
    }
    
    // Aktualizuj ranking
    this.updateLeaderboard();
  }
  
  checkCollisions() {
    const players = Array.from(this.players.values()).filter(p => p.isAlive);
    
    // Kolizje gracz-jedzenie
    for (const player of players) {
      const foodToRemove = [];
      
      for (const [foodId, food] of this.food) {
        if (this.physics.checkCircleCollision(player, food)) {
          if (player.radius > food.radius) {
            player.eatFood(food.mass);
            foodToRemove.push(foodId);
          }
        }
      }
      
      // Usuń zjedzone jedzenie
      for (const foodId of foodToRemove) {
        this.food.delete(foodId);
      }
    }
    
    // Kolizje gracz-gracz
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const player1 = players[i];
        const player2 = players[j];
        
        // Sprawdź kolizję z 80% pokryciem
        if (this.physics.checkCircleCollisionWithOverlap(player1, player2, 0.8)) {
          // Większy gracz zjada mniejszego
          if (player1.radius > player2.radius * 1.1) {
            console.log(`Player ${player1.address} is eating player ${player2.address}`);
            player1.eatPlayer(player2);
            this.removePlayer(player2.address, false);
          } else if (player2.radius > player1.radius * 1.1) {
            console.log(`Player ${player2.address} is eating player ${player1.address}`);
            player2.eatPlayer(player1);
            this.removePlayer(player1.address, false);
          }
        }
      }
    }
  }
  
  updateLeaderboard() {
    this.leaderboard = Array.from(this.players.values())
      .filter(p => p.isAlive)
      .sort((a, b) => {
        // Sortuj po wartości SOL, a potem po masie
        const solDiff = b.solValue - a.solValue;
        if (solDiff !== 0) return solDiff;
        return b.mass - a.mass;
      })
      .slice(0, 10)
      .map((player, index) => ({
        rank: index + 1,
        address: player.address,
        nickname: player.nickname,
        mass: Math.floor(player.mass),
        solValue: player.solValue,
        solDisplay: (player.solValue / 1000000000).toFixed(4), // SOL z 4 miejscami po przecinku
        x: player.x,
        y: player.y
      }));
  }
  
  getGameState() {
    const activePlayers = Array.from(this.players.values()).filter(p => p.isAlive);
    const totalValue = Array.from(this.players.values())
      .reduce((sum, p) => sum + p.solValue, 0);
    
    return {
      mapSize: this.mapSize,
      isRunning: this.isRunning,
      playerCount: activePlayers.length,
      totalPlayers: this.players.size,
      foodCount: this.food.size,
      leaderboard: this.leaderboard,
      totalSolInGame: totalValue,
      totalSolDisplay: (totalValue / 1000000000).toFixed(4),
      stats: {
        totalPlayersJoined: this.totalPlayersJoined,
        totalPlayersCashedOut: this.totalPlayersCashedOut
      }
    };
  }
  
  getPlayerView(playerAddress) {
    const player = this.players.get(playerAddress);
    if (!player) {
      return null;
    }
    
    // Jeśli gracz nie żyje, zwróć specjalny widok
    if (!player.isAlive) {
      return {
        player: {
          x: player.x,
          y: player.y,
          radius: player.radius,
          mass: player.mass,
          color: player.color,
          isAlive: false,
          solValue: player.solValue,
          currentValueSol: player.getCurrentValueInSol()
        },
        players: [],
        food: [],
        leaderboard: this.leaderboard,
        gameState: this.getGameState(),
        canRespawn: player.solValue > 0 // Może respawnować jeśli ma SOL
      };
    }
    
    // Obszar widoczny dla gracza
    const baseViewRadius = 400;
    const viewRadius = baseViewRadius + player.radius * 3;
    
    // Filtruj obiekty w zasięgu wzroku
    const visiblePlayers = Array.from(this.players.values())
      .filter(p => p.isAlive && 
        this.physics.getDistance(player, p) < viewRadius + p.radius)
      .map(p => ({
        id: p.address,
        x: p.x,
        y: p.y,
        radius: p.radius,
        color: p.color,
        nickname: p.nickname,
        mass: p.mass,
        isMe: p.address === playerAddress,
        isBoosting: p.isBoosting,
        solValue: p.solValue,
        solDisplay: (p.solValue / 1000000000).toFixed(4)
      }));
    
    const visibleFood = Array.from(this.food.values())
      .filter(f => this.physics.getDistance(player, f) < viewRadius + f.radius)
      .map(f => ({
        id: f.id,
        x: f.x,
        y: f.y,
        radius: f.radius,
        color: f.color
      }));
    
    return {
      player: {
        address: player.address,
        x: player.x,
        y: player.y,
        radius: player.radius,
        mass: player.mass,
        color: player.color,
        isAlive: player.isAlive,
        isBoosting: player.isBoosting,
        solValue: player.solValue,
        currentValueSol: player.getCurrentValueInSol(),
        playersEaten: player.playersEaten
      },
      players: visiblePlayers,
      food: visibleFood,
      leaderboard: this.leaderboard,
      gameState: this.getGameState()
    };
  }
  
  // Metoda do obsługi cash out
  handleCashOut(playerAddress) {
    const player = this.removePlayer(playerAddress, true);
    if (!player) return null;
    
    return {
      address: playerAddress,
      finalValue: player.solValue,
      finalValueSol: player.getCurrentValueInSol(),
      playersEaten: player.playersEaten,
      totalEarned: player.totalSolEarned
    };
  }
}

module.exports = GameEngine;