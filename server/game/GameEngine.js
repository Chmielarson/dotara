// server/game/GameEngine.js
const Player = require('./Player');
const Food = require('./Food');
const Physics = require('./Physics');

class GameEngine {
  constructor() {
    this.mapSize = 10000; // Mapa 10000x10000
    this.zoneSize = 5000; // Każda strefa 5000x5000
    this.zones = [
      { id: 1, name: 'Bronze Zone', minSol: 0, maxSol: 1, color: '#CD7F32' },
      { id: 2, name: 'Silver Zone', minSol: 1, maxSol: 5, color: '#C0C0C0' },
      { id: 3, name: 'Gold Zone', minSol: 5, maxSol: 10, color: '#FFD700' },
      { id: 4, name: 'Diamond Zone', minSol: 10, maxSol: Infinity, color: '#B9F2FF' }
    ];
    
    // ZMIANA: Dynamiczne skalowanie jedzenia
    this.baseFoodPerZone = 300; // Bazowa ilość jedzenia per strefa
    this.foodPerPlayerMultiplier = 50; // Dodatkowe jedzenie per gracz
    this.maxFoodPerZone = 1000; // Maksimum per strefa
    this.maxTotalFood = 4000; // Maksymalna całkowita ilość jedzenia
    
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
    
    // Callback dla blockchain updates
    this.onPlayerEaten = null;
    
    console.log(`Global game engine created with map size ${this.mapSize} (4 zones of ${this.zoneSize}x${this.zoneSize})`);
    
    // Inicjalizuj jedzenie we wszystkich strefach
    this.initializeFood();
  }
  
  // NOWA METODA: Oblicz docelową ilość jedzenia per strefa
  calculateTargetFoodPerZone() {
    const activePlayers = Array.from(this.players.values()).filter(p => p.isAlive).length;
    // Logarytmiczne skalowanie - nie liniowe
    const scaleFactor = Math.log2(activePlayers + 1) * this.foodPerPlayerMultiplier;
    const targetFood = Math.min(
      this.baseFoodPerZone + scaleFactor,
      this.maxFoodPerZone
    );
    return Math.floor(targetFood);
  }
  
  // Określ strefę na podstawie pozycji
  getZoneFromPosition(x, y) {
    // Mapa 10000x10000 podzielona na 4 strefy 5000x5000
    // [1][2]
    // [3][4]
    if (x < 5000) {
      return y < 5000 ? 1 : 3;
    } else {
      return y < 5000 ? 2 : 4;
    }
  }
  
  // Określ granice strefy
  getZoneBounds(zoneId) {
    switch(zoneId) {
      case 1: return { minX: 0, maxX: 5000, minY: 0, maxY: 5000 };
      case 2: return { minX: 5000, maxX: 10000, minY: 0, maxY: 5000 };
      case 3: return { minX: 0, maxX: 5000, minY: 5000, maxY: 10000 };
      case 4: return { minX: 5000, maxX: 10000, minY: 5000, maxY: 10000 };
      default: return { minX: 0, maxX: 5000, minY: 0, maxY: 5000 };
    }
  }
  
  // Określ odpowiednią strefę dla gracza na podstawie SOL
  getAppropriateZoneForPlayer(solValue) {
    const solInSol = solValue / 1000000000; // Konwersja z lamports na SOL
    
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const zone = this.zones[i];
      if (solInSol >= zone.minSol) {
        return zone.id;
      }
    }
    
    return 1; // Domyślnie strefa 1
  }
  
  // Sprawdź czy gracz może wejść do strefy
  canPlayerEnterZone(player, zoneId) {
    const zone = this.zones[zoneId - 1];
    const playerSol = player.solValue / 1000000000;
    
    // Gracz może wejść do strefy jeśli ma wystarczająco SOL
    // LUB jeśli idzie do niższej strefy (zawsze można zejść niżej)
    return playerSol >= zone.minSol || zoneId < player.currentZone;
  }
  
  initializeFood() {
    // Inicjalizuj jedzenie w każdej strefie
    const targetFood = this.calculateTargetFoodPerZone();
    
    for (let zoneId = 1; zoneId <= 4; zoneId++) {
      const bounds = this.getZoneBounds(zoneId);
      
      // Dodaj początkową ilość jedzenia
      for (let i = 0; i < targetFood; i++) {
        this.spawnFoodInZone(zoneId, bounds);
      }
    }
    
    console.log(`Initialized with ${this.food.size} food items (${targetFood} per zone)`);
  }
  
  spawnFoodInZone(zoneId, bounds) {
    // Zabezpieczenie przed przepełnieniem
    if (this.food.size >= this.maxTotalFood) {
      return;
    }
    
    // Dodaj margines, żeby jedzenie nie pojawiało się na granicach
    const margin = 100;
    const x = bounds.minX + margin + Math.random() * (bounds.maxX - bounds.minX - 2 * margin);
    const y = bounds.minY + margin + Math.random() * (bounds.maxY - bounds.minY - 2 * margin);
    
    const food = new Food(
      x,
      y,
      Math.random() * 15 + 10 // Takie samo jedzenie we wszystkich strefach (10-25)
    );
    food.zoneId = zoneId;
    this.food.set(food.id, food);
  }
  
  // NOWA METODA: Znajdź bezpieczną pozycję spawnu
  findSafeSpawnPosition(appropriateZone, playerRadius) {
    const bounds = this.getZoneBounds(appropriateZone);
    const margin = 200;
    const maxAttempts = 50;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const x = bounds.minX + margin + Math.random() * (bounds.maxX - bounds.minX - 2 * margin);
      const y = bounds.minY + margin + Math.random() * (bounds.maxY - bounds.minY - 2 * margin);
      
      // Sprawdź czy pozycja jest bezpieczna
      let isSafe = true;
      const minSafeDistance = playerRadius * 4; // Minimalna bezpieczna odległość
      
      // Sprawdź odległość od innych graczy
      for (const otherPlayer of this.players.values()) {
        if (!otherPlayer.isAlive) continue;
        
        const distance = this.physics.getDistance({ x, y }, otherPlayer);
        
        // Jeśli inny gracz jest za blisko
        if (distance < otherPlayer.radius + minSafeDistance) {
          isSafe = false;
          break;
        }
        
        // Jeśli inny gracz jest większy i bardzo blisko
        if (otherPlayer.radius > playerRadius * 1.5 && distance < otherPlayer.radius * 3) {
          isSafe = false;
          break;
        }
      }
      
      if (isSafe) {
        console.log(`Found safe spawn position after ${attempt + 1} attempts`);
        return { x, y };
      }
    }
    
    // Jeśli nie znaleziono bezpiecznej pozycji, zwróć losową
    console.log('Could not find perfectly safe spawn position, using random');
    const x = bounds.minX + margin + Math.random() * (bounds.maxX - bounds.minX - 2 * margin);
    const y = bounds.minY + margin + Math.random() * (bounds.maxY - bounds.minY - 2 * margin);
    return { x, y };
  }
  
  addPlayer(playerAddress, nickname = null, initialStake = 0) {
    // Sprawdź czy gracz już istnieje
    let player = this.players.get(playerAddress);
    
    if (player) {
      // Gracz istnieje - nie powinno się zdarzyć bo usuwamy natychmiast
      console.log(`WARNING: Player ${playerAddress} still exists in game map!`);
      
      if (!player.isAlive) {
        // Martwy gracz - usuń go i kontynuuj
        this.players.delete(playerAddress);
        console.log(`Removed dead player ${playerAddress} before creating new one`);
      } else {
        // Gracz żyje - zwróć istniejącego
        console.log(`Player ${playerAddress} already in game and alive`);
        return player;
      }
    }
    
    // Określ odpowiednią strefę startową na podstawie stake
    const stakeSol = initialStake / 1000000000; // Konwersja na SOL
    let appropriateZone = 1; // Domyślnie Bronze
    
    if (stakeSol >= 10) {
      appropriateZone = 4; // Diamond Zone
    } else if (stakeSol >= 5) {
      appropriateZone = 3; // Gold Zone
    } else if (stakeSol >= 1) {
      appropriateZone = 2; // Silver Zone
    }
    
    // Nowy gracz - najpierw stwórz tymczasowego gracza żeby znać jego promień
    const tempPlayer = new Player(playerAddress, 0, 0, nickname, initialStake);
    const playerRadius = tempPlayer.calculateRadius();
    
    // ZMIANA: Znajdź bezpieczną pozycję spawnu
    const spawnPos = this.findSafeSpawnPosition(appropriateZone, playerRadius);
    
    // Stwórz gracza w bezpiecznej pozycji
    player = new Player(playerAddress, spawnPos.x, spawnPos.y, nickname, initialStake);
    player.currentZone = appropriateZone;
    this.players.set(playerAddress, player);
    this.totalSolInGame += initialStake;
    this.totalPlayersJoined++;
    
    console.log(`Player ${playerAddress} joined in Zone ${appropriateZone} (${this.zones[appropriateZone - 1].name}) at safe position (${Math.floor(spawnPos.x)}, ${Math.floor(spawnPos.y)}) with stake: ${stakeSol} SOL, starting mass: ${player.mass}`);
    
    return player;
  }
  
  removePlayer(playerAddress, cashOut = false) {
    const player = this.players.get(playerAddress);
    if (!player) return null;
    
    if (cashOut) {
      // Cash out - usuń całkowicie
      this.totalSolInGame -= player.solValue;
      this.totalPlayersCashedOut++;
      this.players.delete(playerAddress);
      console.log(`Player ${playerAddress} cashed out with ${player.solValue} lamports from Zone ${player.currentZone}`);
      return player;
    } else {
      // Zjedzony - usuń NATYCHMIAST
      player.isAlive = false;
      player.mass = 0;
      const lostValue = player.solValue;
      player.solValue = 0; // Stracił wszystko
      this.convertPlayerToFood(player);
      this.totalSolInGame -= lostValue; // SOL został przekazany innemu graczowi
      
      // USUŃ GRACZA NATYCHMIAST!
      this.players.delete(playerAddress);
      
      console.log(`Player ${playerAddress} was eaten and removed from game immediately`);
      return player;
    }
  }
  
  convertPlayerToFood(player) {
    // Rozdziel masę gracza na jedzenie w jego strefie
    const numFood = Math.min(Math.floor(player.mass / 20), 10);
    const foodMass = player.mass / numFood;
    const zoneId = this.getZoneFromPosition(player.x, player.y);
    
    for (let i = 0; i < numFood; i++) {
      const angle = (Math.PI * 2 * i) / numFood;
      const distance = player.radius + Math.random() * 50;
      
      const food = new Food(
        player.x + Math.cos(angle) * distance,
        player.y + Math.sin(angle) * distance,
        foodMass
      );
      food.zoneId = zoneId;
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
    food.zoneId = this.getZoneFromPosition(player.x, player.y);
    
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
    
    console.log('Global game engine started with zone system');
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
        const oldX = player.x;
        const oldY = player.y;
        const oldZone = this.getZoneFromPosition(oldX, oldY);
        
        player.update(deltaTime, this.mapSize);
        
        // Sprawdź czy gracz próbuje wejść do nowej strefy
        const newZone = this.getZoneFromPosition(player.x, player.y);
        
        if (newZone !== oldZone) {
          // Sprawdź czy gracz może wejść do nowej strefy
          if (!this.canPlayerEnterZone(player, newZone)) {
            // Zablokuj ruch - przywróć starą pozycję
            player.x = oldX;
            player.y = oldY;
            
            // Odbij gracza od bariery
            const bounds = this.getZoneBounds(oldZone);
            player.x = Math.max(bounds.minX + player.radius, Math.min(bounds.maxX - player.radius, player.x));
            player.y = Math.max(bounds.minY + player.radius, Math.min(bounds.maxY - player.radius, player.y));
          } else {
            // Gracz może wejść - zaktualizuj jego strefę
            player.currentZone = newZone;
            console.log(`Player ${player.address} entered Zone ${newZone} (${this.zones[newZone - 1].name})`);
          }
        }
        
        // Aktualizuj czy gracz może awansować do wyższej strefy
        const appropriateZone = this.getAppropriateZoneForPlayer(player.solValue);
        if (appropriateZone > player.currentZone) {
          player.canAdvanceToZone = appropriateZone;
        } else {
          player.canAdvanceToZone = null;
        }
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
        
        // Granice strefy
        const zoneId = food.zoneId || this.getZoneFromPosition(food.x, food.y);
        const bounds = this.getZoneBounds(zoneId);
        food.x = Math.max(bounds.minX, Math.min(bounds.maxX, food.x));
        food.y = Math.max(bounds.minY, Math.min(bounds.maxY, food.y));
      }
    }
    
    // Sprawdź kolizje
    this.checkCollisions();
    
    // ZMIANA: Dynamiczne uzupełnianie jedzenia
    const targetFoodPerZone = this.calculateTargetFoodPerZone();
    
    for (let zoneId = 1; zoneId <= 4; zoneId++) {
      const bounds = this.getZoneBounds(zoneId);
      
      // Policz jedzenie w tej strefie
      const foodInZone = Array.from(this.food.values()).filter(f => {
        const foodZone = this.getZoneFromPosition(f.x, f.y);
        return foodZone === zoneId;
      }).length;
      
      // Dodaj brakujące jedzenie
      const foodToAdd = Math.max(0, targetFoodPerZone - foodInZone);
      for (let i = 0; i < foodToAdd; i++) {
        this.spawnFoodInZone(zoneId, bounds);
      }
    }
    
    // Aktualizuj ranking
    this.updateLeaderboard();
    
    // Co 30 sekund loguj statystyki jedzenia
    if (now % 30000 < 16) {
      const activePlayers = Array.from(this.players.values()).filter(p => p.isAlive).length;
      console.log(`Food stats: ${this.food.size} total, target per zone: ${targetFoodPerZone}, active players: ${activePlayers}`);
    }
  }
  
  checkCollisions() {
    const players = Array.from(this.players.values()).filter(p => p.isAlive && !p.isCashingOut);
    const playersToRemove = [];
    
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
        
        // Pomiń graczy w trakcie cash out
        if (player1.isCashingOut || player2.isCashingOut) continue;
        
        // NAJPIERW sprawdź czy gracze się dotykają (dla combat log)
        if (this.physics.checkCircleCollision(player1, player2)) {
          // Oznacz OBYDWU graczy jako w walce - niezależnie od tego czy ktoś zostanie zjedzony
          player1.enterCombat();
          player2.enterCombat();
          
          // TERAZ sprawdź czy ktoś kogoś zjada (80% pokrycia)
          if (this.physics.checkCircleCollisionWithOverlap(player1, player2, 0.8)) {
            // Większy gracz zjada mniejszego
            if (player1.radius > player2.radius * 1.1) {
              console.log(`Player ${player1.address} is eating player ${player2.address}`);
              const eatenValue = player2.solValue;
              player1.eatPlayer(player2);
              playersToRemove.push(player2.address);
              
              // Wywołaj callback do aktualizacji blockchain
              if (this.onPlayerEaten) {
                this.onPlayerEaten(player1.address, player2.address, eatenValue);
              }
              
            } else if (player2.radius > player1.radius * 1.1) {
              console.log(`Player ${player2.address} is eating player ${player1.address}`);
              const eatenValue = player1.solValue;
              player2.eatPlayer(player1);
              playersToRemove.push(player1.address);
              
              // Wywołaj callback do aktualizacji blockchain
              if (this.onPlayerEaten) {
                this.onPlayerEaten(player2.address, player1.address, eatenValue);
              }
            }
          }
        }
      }
    }
    
    // Usuń graczy po zakończeniu sprawdzania kolizji
    for (const playerAddress of playersToRemove) {
      this.removePlayer(playerAddress, false);
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
        zone: player.currentZone,
        zoneName: this.zones[player.currentZone - 1].name,
        x: player.x,
        y: player.y
      }));
  }
  
  getGameState() {
    const activePlayers = Array.from(this.players.values()).filter(p => p.isAlive);
    const totalValue = Array.from(this.players.values())
      .filter(p => p.isAlive) // Tylko żywi gracze mają SOL
      .reduce((sum, p) => sum + p.solValue, 0);
    
    // Statystyki per strefa
    const zoneStats = {};
    for (let i = 1; i <= 4; i++) {
      const playersInZone = activePlayers.filter(p => p.currentZone === i);
      zoneStats[i] = {
        playerCount: playersInZone.length,
        totalSol: playersInZone.reduce((sum, p) => sum + p.solValue, 0) / 1000000000
      };
    }
    
    return {
      mapSize: this.mapSize,
      zoneSize: this.zoneSize,
      zones: this.zones,
      zoneStats,
      isRunning: this.isRunning,
      playerCount: activePlayers.length,
      totalPlayers: this.players.size,
      foodCount: this.food.size,
      targetFoodPerZone: this.calculateTargetFoodPerZone(),
      leaderboard: this.leaderboard,
      totalSolInGame: totalValue,
      totalSolDisplay: (totalValue / 1000000000).toFixed(4),
      stats: {
        totalPlayersJoined: this.totalPlayersJoined,
        totalPlayersCashedOut: this.totalPlayersCashedOut,
        deadPlayers: Array.from(this.players.values()).filter(p => !p.isAlive).length
      }
    };
  }
  
  getPlayerView(playerAddress) {
    const player = this.players.get(playerAddress);
    if (!player) {
      return null;
    }
    
    // Jeśli gracz nie żyje (został zjedzony), nie ma już widoku
    if (!player.isAlive) {
      return null;
    }
    
    // Obszar widoczny dla gracza
    const baseViewRadius = 600;
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
        solDisplay: (p.solValue / 1000000000).toFixed(4),
        zone: p.currentZone
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
    
    // Informacje o barierach stref
    const currentZone = this.getZoneFromPosition(player.x, player.y);
    const zoneBounds = this.getZoneBounds(currentZone);
    const barriers = [];
    
    // Sprawdź które bariery są widoczne
    // Górna bariera
    if (Math.abs(player.y - zoneBounds.minY) < viewRadius && currentZone > 2) {
      barriers.push({
        type: 'horizontal',
        x: zoneBounds.minX,
        y: zoneBounds.minY,
        width: zoneBounds.maxX - zoneBounds.minX,
        canPass: this.canPlayerEnterZone(player, currentZone - 2)
      });
    }
    
    // Dolna bariera
    if (Math.abs(player.y - zoneBounds.maxY) < viewRadius && currentZone < 3) {
      barriers.push({
        type: 'horizontal',
        x: zoneBounds.minX,
        y: zoneBounds.maxY,
        width: zoneBounds.maxX - zoneBounds.minX,
        canPass: this.canPlayerEnterZone(player, currentZone + 2)
      });
    }
    
    // Lewa bariera
    if (Math.abs(player.x - zoneBounds.minX) < viewRadius && currentZone % 2 === 0) {
      barriers.push({
        type: 'vertical',
        x: zoneBounds.minX,
        y: zoneBounds.minY,
        height: zoneBounds.maxY - zoneBounds.minY,
        canPass: this.canPlayerEnterZone(player, currentZone - 1)
      });
    }
    
    // Prawa bariera
    if (Math.abs(player.x - zoneBounds.maxX) < viewRadius && currentZone % 2 === 1) {
      barriers.push({
        type: 'vertical',
        x: zoneBounds.maxX,
        y: zoneBounds.minY,
        height: zoneBounds.maxY - zoneBounds.minY,
        canPass: this.canPlayerEnterZone(player, currentZone + 1)
      });
    }
    
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
        playersEaten: player.playersEaten,
        currentZone: player.currentZone,
        zoneName: this.zones[player.currentZone - 1].name,
        canAdvanceToZone: player.canAdvanceToZone,
        canCashOut: player.canCashOut(),
        combatCooldownRemaining: player.getCombatCooldownRemaining()
      },
      players: visiblePlayers,
      food: visibleFood,
      barriers: barriers,
      zones: this.zones,
      currentZoneInfo: this.zones[currentZone - 1],
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
      totalEarned: player.totalSolEarned,
      finalZone: player.currentZone
    };
  }
}

module.exports = GameEngine;