// server/game/Physics.js
class Physics {
  constructor() {
    // Stałe fizyczne
    this.friction = 0.95;
    this.restitution = 0.8;
  }
  
  // Sprawdzanie kolizji między okręgami
  checkCircleCollision(obj1, obj2) {
    const distance = this.getDistance(obj1, obj2);
    return distance < obj1.radius + obj2.radius;
  }
  
  // Obliczanie odległości między obiektami
  getDistance(obj1, obj2) {
    const dx = obj2.x - obj1.x;
    const dy = obj2.y - obj1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  
  // Sprawdzanie czy obj1 może zjeść obj2
  canEat(obj1, obj2) {
    // obj1 musi być większy o co najmniej 10%
    return obj1.radius > obj2.radius * 1.1;
  }
  
  // Obliczanie nowej masy po zjedzeniu
  calculateNewMass(eaterMass, foodMass) {
    return eaterMass + foodMass * 0.8; // 80% efektywność
  }
  
  // Sprawdzanie czy obiekt jest w obszarze widoczności
  isInViewport(viewer, target, viewportRadius) {
    const distance = this.getDistance(viewer, target);
    return distance < viewportRadius + target.radius;
  }
  
  // Obliczanie prędkości na podstawie masy
  calculateSpeed(mass, baseSpeed = 5) {
    // Im większa masa, tym wolniejszy ruch
    return baseSpeed * (20 / (mass + 20));
  }
  
  // Elastyczne odbicie przy kolizji
  resolveCollision(obj1, obj2) {
    const dx = obj2.x - obj1.x;
    const dy = obj2.y - obj1.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance === 0) return; // Uniknij dzielenia przez zero
    
    // Normalizuj wektor
    const nx = dx / distance;
    const ny = dy / distance;
    
    // Minimalna odległość
    const minDistance = obj1.radius + obj2.radius;
    
    // Rozdziel obiekty
    const overlap = minDistance - distance;
    if (overlap > 0) {
      const separationX = nx * overlap * 0.5;
      const separationY = ny * overlap * 0.5;
      
      obj1.x -= separationX;
      obj1.y -= separationY;
      obj2.x += separationX;
      obj2.y += separationY;
    }
  }
  
  // Interpolacja dla płynnego ruchu
  lerp(start, end, factor) {
    return start + (end - start) * factor;
  }
  
  // Ograniczenie wartości do zakresu
  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
}

module.exports = Physics;