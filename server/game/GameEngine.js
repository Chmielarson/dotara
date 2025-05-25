// server/game/GameEngine.js
const Player = require('./Player');
const Food = require('./Food');
const Physics = require('./Physics');

class GameEngine {
  constructor(roomId, mapSize = 3000, maxFood = 500) {
    this.roomId = roomId;
    this.mapSize = mapSize;
    this.maxFood = maxFood;
    this.players = new Map();
    this.food = new Map();
    this.physics = new Physics();
    this.isRunning = false;
    this.lastUpdate = Date.now();
    this.tickRate = 60; // 60 FPS
    this.gameLoop = null;
    this.leaderboard = [];
    this.winner = null;
    this.eliminatedPlayers = new Set();
    
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
  
  addPlayer(playerAddress, nickname = null) {
    if (this.players.has(playerAddress)) {
      return this.players.get(playerAddress);
    }
    
    // Losowa pozycja startowa
    const x = Math.random() * this.mapSize;
    const y = Math.random() * this.mapSize;
    
    const player = new Player(playerAddress, x, y, nickname);
    this.players.set(playerAddress, player);
    
    console.log(`Player ${playerAddress} added to game ${this.roomId}`);
    return player;
  }
  
  removePlayer(playerAddress) {
    const player = this.players.get(playerAddress);
    if (player) {
      // Zamień gracza na jedzenie
      this.convertPlayerToFood(player);
      this.players.delete(playerAddress);
      this.eliminatedPlayers.add(playerAddress);
      
      console.log(`Player ${playerAddress} removed from game ${this.roomId}`);
      
      // Sprawdź czy został tylko jeden gracz
      const activePlayers = Array.from(this.players.values()).filter(p => p.isAlive);
      if (activePlayers.length === 1 && this.isRunning) {
        this.winner = activePlayers[0].address;
        this.stop();
      }
    }
  }
  
  convertPlayerToFood(player) {
    // Rozdziel masę gracza na kilka kulek jedzenia
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
    
    // Aktualizuj kierunek ruchu gracza
    if (input.mouseX !== undefined && input.mouseY !== undefined) {
      player.setTarget(input.mouseX, input.mouseY);
    }
    
    // Obsługa podziału (space)
    if (input.split && player.canSplit()) {
      this.splitPlayer(player);
    }
    
    // Obsługa wyrzucania masy (W)
    if (input.eject && player.canEject()) {
      this.ejectMass(player);
    }
  }
  
  splitPlayer(player) {
    if (player.mass < 35) return; // Minimalna masa do podziału
    
    const halfMass = player.mass / 2;
    player.mass = halfMass;
    player.updateRadius();
    
    // Stwórz nową część gracza
    const angle = Math.atan2(player.targetY - player.y, player.targetX - player.x);
    const distance = player.radius * 4;
    
    const newPart = {
      x: player.x + Math.cos(angle) * distance,
      y: player.y + Math.sin(angle) * distance,
      mass: halfMass,
      velocityX: Math.cos(angle) * 10,
      velocityY: Math.sin(angle) * 10
    };
    
    // TODO: Implementacja wieloczęściowych graczy
    console.log('Split player:', player.address);
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
    food.velocityX = Math.cos(angle) * 8;
    food.velocityY = Math.sin(angle) * 8;
    
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
    
    console.log(`Game ${this.roomId} started`);
  }
  
  stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    if (this.gameLoop) {
      clearInterval(this.gameLoop);
      this.gameLoop = null;
    }
    
    console.log(`Game ${this.roomId} stopped. Winner: ${this.winner}`);
  }
  
  update() {
    const now = Date.now();
    const deltaTime = (now - this.lastUpdate) / 1000; // w sekundach
    this.lastUpdate = now;
    
    // Aktualizuj pozycje graczy
    for (const player of this.players.values()) {
      if (player.isAlive) {
        player.update(deltaTime, this.mapSize);
      }
    }
    
    // Aktualizuj pozycje jedzenia (dla wyrzuconej masy)
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
            player.eat(food.mass);
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
        
        if (this.physics.checkCircleCollision(player1, player2)) {
          // Większy gracz zjada mniejszego
          if (player1.radius > player2.radius * 1.1) {
            player1.eat(player2.mass);
            player2.die();
            this.eliminatedPlayers.add(player2.address);
          } else if (player2.radius > player1.radius * 1.1) {
            player2.eat(player1.mass);
            player1.die();
            this.eliminatedPlayers.add(player1.address);
          }
        }
      }
    }
  }
  
  updateLeaderboard() {
    this.leaderboard = Array.from(this.players.values())
      .filter(p => p.isAlive)
      .sort((a, b) => b.mass - a.mass)
      .slice(0, 10)
      .map((player, index) => ({
        rank: index + 1,
        address: player.address,
        nickname: player.nickname,
        mass: Math.floor(player.mass),
        x: player.x,
        y: player.y
      }));
  }
  
  getGameState() {
    return {
      roomId: this.roomId,
      mapSize: this.mapSize,
      isRunning: this.isRunning,
      winner: this.winner,
      playerCount: this.players.size,
      foodCount: this.food.size,
      leaderboard: this.leaderboard,
      eliminatedPlayers: Array.from(this.eliminatedPlayers)
    };
  }
  
  getPlayerView(playerAddress) {
    const player = this.players.get(playerAddress);
    if (!player) return null;
    
    // Obszar widoczny dla gracza
    const viewRadius = 500 + player.radius * 2;
    
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
        isMe: p.address === playerAddress
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
        x: player.x,
        y: player.y,
        radius: player.radius,
        mass: player.mass,
        color: player.color,
        isAlive: player.isAlive
      },
      players: visiblePlayers,
      food: visibleFood,
      leaderboard: this.leaderboard,
      gameState: this.getGameState()
    };
  }
}

module.exports = GameEngine;