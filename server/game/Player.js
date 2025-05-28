// server/game/Player.js
class Player {
  constructor(address, x, y, nickname = null, initialStake = 0) {
    this.address = address;
    this.nickname = nickname || `Player ${address.substring(0, 6)}`;
    this.x = x;
    this.y = y;
    
    // Rozdzielenie masy i wartości SOL
    this.mass = 20; // Masa startowa (tylko wpływa na rozmiar)
    this.solValue = initialStake; // Wartość w SOL (w lamports)
    this.initialStake = initialStake; // Ile gracz wniósł na start
    
    this.radius = this.calculateRadius();
    this.color = this.generateColor();
    this.isAlive = true;
    this.score = 0;
    
    // Informacje o strefie
    this.currentZone = 1; // Domyślnie strefa 1
    this.canAdvanceToZone = null; // Czy może awansować do wyższej strefy
    
    // Cel ruchu
    this.targetX = x;
    this.targetY = y;
    
    // Prędkość
    this.velocityX = 0;
    this.velocityY = 0;
    this.baseSpeed = 3;
    this.isBoosting = false;
    this.boostEndTime = 0;
    
    // Ograniczenia
    this.lastSplitTime = 0;
    this.lastEjectTime = 0;
    this.splitCooldown = 3000; // 3 sekundy
    this.ejectCooldown = 100; // 100ms
    
    // Statystyki
    this.playersEaten = 0;
    this.totalSolEarned = 0;
    
    // Cash out status
    this.isCashingOut = false; // Czy gracz jest w trakcie cash out
    
    console.log(`Player created: ${nickname} (${address}) with stake: ${initialStake} lamports`);
  }
  
  calculateRadius() {
    // Promień bazuje tylko na masie, nie na wartości SOL
    return Math.sqrt(this.mass / Math.PI) * 5;
  }
  
  updateRadius() {
    this.radius = this.calculateRadius();
  }
  
  generateColor() {
    // Kolor może się zmieniać w zależności od wartości SOL
    const hue = Math.floor(Math.random() * 360);
    // Im więcej SOL, tym bardziej nasycony kolor
    const saturation = Math.min(90, 50 + (this.solValue / 1000000000) * 40); // 1 SOL = 1B lamports
    return `hsl(${hue}, ${saturation}%, 50%)`;
  }
  
  updateColor() {
    // Aktualizuj kolor gdy zmienia się wartość SOL
    const match = this.color.match(/hsl\((\d+),/);
    if (match) {
      const hue = parseInt(match[1]);
      const saturation = Math.min(90, 50 + (this.solValue / 1000000000) * 40);
      this.color = `hsl(${hue}, ${saturation}%, 50%)`;
    }
  }
  
  setTarget(x, y) {
    this.targetX = x;
    this.targetY = y;
  }
  
  update(deltaTime, mapSize) {
    if (!this.isAlive) return;
    
    // Sprawdź czy boost się skończył
    if (this.isBoosting && Date.now() > this.boostEndTime) {
      this.isBoosting = false;
    }
    
    // Oblicz kierunek do celu
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > 1) {
      // Normalizuj kierunek
      const dirX = dx / distance;
      const dirY = dy / distance;
      
      // Prędkość zależy od masy
      let speed = this.baseSpeed * (30 / (Math.sqrt(this.mass) + 20));
      
      // Minimalna prędkość
      speed = Math.max(speed, this.baseSpeed * 0.3);
      
      // Jeśli boost jest aktywny, zwiększ prędkość
      if (this.isBoosting) {
        speed *= 3; // 3x szybciej podczas boosta
      }
      
      // Aktualizuj prędkość
      this.velocityX = dirX * speed;
      this.velocityY = dirY * speed;
      
      // Aktualizuj pozycję
      this.x += this.velocityX * deltaTime * 60;
      this.y += this.velocityY * deltaTime * 60;
      
      // Ograniczenia mapy
      const mapMargin = this.radius * 0.3;
      this.x = Math.max(-mapMargin, Math.min(mapSize + mapMargin, this.x));
      this.y = Math.max(-mapMargin, Math.min(mapSize + mapMargin, this.y));
    }
    
    // Stopniowa utrata masy (0.2% na sekundę) - NIE trać wartości SOL!
    if (this.mass > 20) {
      this.mass *= (1 - 0.002 * deltaTime);
      this.updateRadius();
    }
  }
  
  // Jedzenie zwykłego jedzenia - dodaje tylko masę
  eatFood(foodMass) {
    this.mass += foodMass;
    this.score += Math.floor(foodMass);
    this.updateRadius();
  }
  
  // Jedzenie gracza - dodaje masę i SOL
  eatPlayer(otherPlayer) {
    // Dodaj masę zjedzonego gracza
    this.mass += otherPlayer.mass;
    
    // WAŻNE: Dodaj CAŁĄ wartość SOL zjedzonego gracza
    const gainedSol = otherPlayer.solValue;
    this.solValue += gainedSol;
    this.totalSolEarned += gainedSol;
    
    // Bonus masy za wartość SOL gracza (1 SOL = 100 dodatkowej masy)
    const solBonus = (gainedSol / 1000000000) * 100;
    this.mass += solBonus;
    
    this.playersEaten++;
    this.score += Math.floor(otherPlayer.mass + solBonus);
    
    this.updateRadius();
    this.updateColor(); // Aktualizuj kolor po zmianie wartości SOL
    
    console.log(`Player ${this.address} ate ${otherPlayer.address}. ` +
                `Gained ${gainedSol} lamports (${gainedSol/1000000000} SOL) and ${otherPlayer.mass + solBonus} mass. ` +
                `New total SOL value: ${this.solValue} lamports (${this.solValue/1000000000} SOL)`);
  }
  
  canSplit() {
    const now = Date.now();
    return (
      this.mass >= 35 && 
      now - this.lastSplitTime > this.splitCooldown &&
      !this.isBoosting
    );
  }
  
  canEject() {
    const now = Date.now();
    return (
      this.mass >= 35 && 
      now - this.lastEjectTime > this.ejectCooldown
    );
  }
  
  split() {
    if (!this.canSplit()) return false;
    
    // Zabierz 10% masy za boost
    const boostCost = this.mass * 0.1;
    this.mass -= boostCost;
    this.updateRadius();
    
    // Aktywuj boost na 1.5 sekundy
    this.isBoosting = true;
    this.boostEndTime = Date.now() + 1500;
    
    this.lastSplitTime = Date.now();
    return true;
  }
  
  eject() {
    if (!this.canEject()) return false;
    
    this.lastEjectTime = Date.now();
    return true;
  }
  
  die() {
    this.isAlive = false;
    // Gracz zachowuje swoją wartość SOL nawet po śmierci
    // (będzie mógł ją wypłacić lub użyć do respawnu)
  }
  
  // Metoda do respawnu gracza
  respawn(x, y) {
    this.isAlive = true;
    this.x = x;
    this.y = y;
    this.mass = 20; // Reset masy do startowej
    // SOL value pozostaje bez zmian!
    this.updateRadius();
    this.updateColor();
  }
  
  // Oblicz aktualną wartość gracza w SOL
  getCurrentValueInSol() {
    return this.solValue / 1000000000; // Konwersja z lamports na SOL
  }
  
  toJSON() {
    return {
      address: this.address,
      nickname: this.nickname,
      x: this.x,
      y: this.y,
      mass: this.mass,
      radius: this.radius,
      color: this.color,
      isAlive: this.isAlive,
      score: this.score,
      isBoosting: this.isBoosting,
      solValue: this.solValue,
      currentValueSol: this.getCurrentValueInSol(),
      playersEaten: this.playersEaten,
      currentZone: this.currentZone,
      canAdvanceToZone: this.canAdvanceToZone
    };
  }
}

module.exports = Player;