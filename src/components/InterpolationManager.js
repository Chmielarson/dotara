// src/components/InterpolationManager.js
export class InterpolationManager {
  constructor(interpolationTime = 100) {
    this.entities = new Map();
    this.interpolationTime = interpolationTime;
    this.serverUpdateRate = 60; // 60 FPS from server
    this.clientRenderRate = 60; // Target 60 FPS on client
  }
  
  updateEntity(id, newState, timestamp = Date.now()) {
    const entity = this.entities.get(id);
    
    if (!entity) {
      // Nowa entity
      this.entities.set(id, {
        previous: newState,
        current: newState,
        target: newState,
        lastUpdate: timestamp,
        updateCount: 0
      });
      return;
    }
    
    // Przesuń stany
    entity.previous = entity.current;
    entity.current = entity.target;
    entity.target = newState;
    entity.lastUpdate = timestamp;
    entity.updateCount++;
    
    // Oblicz prędkość dla ekstrapolacji
    const timeDelta = timestamp - entity.lastUpdate;
    if (timeDelta > 0) {
      entity.velocity = {
        x: (newState.x - entity.current.x) / timeDelta * 1000,
        y: (newState.y - entity.current.y) / timeDelta * 1000
      };
    }
  }
  
  getInterpolatedState(id, currentTime = Date.now()) {
    const entity = this.entities.get(id);
    if (!entity) return null;
    
    // Oblicz czas od ostatniej aktualizacji
    const elapsed = currentTime - entity.lastUpdate;
    
    // Interpolacja
    if (elapsed < this.interpolationTime) {
      const t = elapsed / this.interpolationTime;
      return this.interpolate(entity.current, entity.target, t);
    }
    
    // Ekstrapolacja (jeśli serwer się spóźnia)
    if (elapsed > this.interpolationTime * 1.5 && entity.velocity) {
      const extrapolationTime = Math.min(elapsed - this.interpolationTime, 200); // Max 200ms ekstrapolacji
      return {
        ...entity.target,
        x: entity.target.x + entity.velocity.x * extrapolationTime / 1000,
        y: entity.target.y + entity.velocity.y * extrapolationTime / 1000
      };
    }
    
    return entity.target;
  }
  
  interpolate(from, to, t) {
    // Cubic interpolation dla płynniejszego ruchu
    const smoothT = this.smoothStep(0, 1, t);
    
    return {
      x: from.x + (to.x - from.x) * smoothT,
      y: from.y + (to.y - from.y) * smoothT,
      radius: from.radius + (to.radius - from.radius) * smoothT,
      // Inne właściwości bez interpolacji
      color: to.color,
      nickname: to.nickname,
      isMe: to.isMe,
      isBoosting: to.isBoosting,
      mass: to.mass,
      solValue: to.solValue
    };
  }
  
  smoothStep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }
  
  removeEntity(id) {
    this.entities.delete(id);
  }
  
  clear() {
    this.entities.clear();
  }
  
  // Pobierz wszystkie interpolowane stany
  getAllInterpolatedStates(currentTime = Date.now()) {
    const states = new Map();
    
    for (const [id, entity] of this.entities) {
      const interpolated = this.getInterpolatedState(id, currentTime);
      if (interpolated) {
        states.set(id, interpolated);
      }
    }
    
    return states;
  }
  
  // Diagnostyka
  getStats() {
    let totalEntities = this.entities.size;
    let staleEntities = 0;
    const now = Date.now();
    
    for (const entity of this.entities.values()) {
      if (now - entity.lastUpdate > 1000) {
        staleEntities++;
      }
    }
    
    return {
      totalEntities,
      staleEntities,
      interpolationTime: this.interpolationTime
    };
  }
}