// server/game/Player.js
class Player {
  constructor(address, x, y, nickname = null) {
    this.address = address;
    this.nickname = nickname || `Player ${address.substring(0, 6)}`;
    this.x = x;
    this.y = y;
    this.mass = 20; // Masa startowa
    this.radius = this.calculateRadius();
    this.color = this.generateColor();
    this.isAlive = true;
    this.score = 0;
    
    // Cel ruchu
    this.targetX = x;
    this.targetY = y;
    
    // Prędkość
    this.velocityX = 0;
    this.velocityY = 0;
    this.baseSpeed = 15; // Zwiększone z 5 na 15 (3x szybciej)
    
    // Ograniczenia
    this.lastSplitTime = 0;
    this.lastEjectTime = 0;
    this.splitCooldown = 3000; // 3 sekundy
    this.ejectCooldown = 100; // 100ms
  }
  
  calculateRadius() {
    // Promień na podstawie masy (powierzchnia koła)
    return Math.sqrt(this.mass / Math.PI) * 5;
  }
  
  updateRadius() {
    this.radius = this.calculateRadius();
  }
  
  generateColor() {
    // Generuj ładny, jasny kolor
    const hue = Math.floor(Math.random() * 360);
    return `hsl(${hue}, 70%, 50%)`;
  }
  
  setTarget(x, y) {
    this.targetX = x;
    this.targetY = y;
  }
  
  update(deltaTime, mapSize) {
    if (!this.isAlive) return;
    
    // Oblicz kierunek do celu
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > 1) {
      // Normalizuj kierunek
      const dirX = dx / distance;
      const dirY = dy / distance;
      
      // Prędkość zależy od masy (większy = wolniejszy)
      const speed = this.baseSpeed * (20 / (this.mass + 20));
      
      // Aktualizuj prędkość
      this.velocityX = dirX * speed;
      this.velocityY = dirY * speed;
      
      // Aktualizuj pozycję
      this.x += this.velocityX * deltaTime * 60;
      this.y += this.velocityY * deltaTime * 60;
      
      // Ograniczenia mapy
      this.x = Math.max(this.radius, Math.min(mapSize - this.radius, this.x));
      this.y = Math.max(this.radius, Math.min(mapSize - this.radius, this.y));
    }
    
    // Stopniowa utrata masy (0.2% na sekundę)
    if (this.mass > 20) {
      this.mass *= (1 - 0.002 * deltaTime);
      this.updateRadius();
    }
  }
  
  eat(foodMass) {
    this.mass += foodMass;
    this.score += Math.floor(foodMass);
    this.updateRadius();
  }
  
  canSplit() {
    const now = Date.now();
    return (
      this.mass >= 35 && 
      now - this.lastSplitTime > this.splitCooldown
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
      score: this.score
    };
  }
}

module.exports = Player;