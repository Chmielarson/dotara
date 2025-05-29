// server/game/SpatialGrid.js
class SpatialGrid {
  constructor(mapSize, cellSize = 500) {
    this.mapSize = mapSize;
    this.cellSize = cellSize;
    this.gridSize = Math.ceil(mapSize / cellSize);
    this.grid = new Map();
    this.objectCells = new Map(); // Track which cell each object is in
  }
  
  getGridKey(x, y) {
    const gridX = Math.floor(x / this.cellSize);
    const gridY = Math.floor(y / this.cellSize);
    return `${gridX},${gridY}`;
  }
  
  addObject(obj) {
    const key = this.getGridKey(obj.x, obj.y);
    
    // Remove from old cell if exists
    this.removeObject(obj);
    
    // Add to new cell
    if (!this.grid.has(key)) {
      this.grid.set(key, new Set());
    }
    this.grid.get(key).add(obj);
    this.objectCells.set(obj.id || obj, key);
  }
  
  removeObject(obj) {
    const oldKey = this.objectCells.get(obj.id || obj);
    if (oldKey) {
      const cell = this.grid.get(oldKey);
      if (cell) {
        cell.delete(obj);
        if (cell.size === 0) {
          this.grid.delete(oldKey);
        }
      }
      this.objectCells.delete(obj.id || obj);
    }
  }
  
  updateObject(obj, oldX, oldY) {
    const oldKey = this.getGridKey(oldX, oldY);
    const newKey = this.getGridKey(obj.x, obj.y);
    
    if (oldKey !== newKey) {
      this.removeObject(obj);
      this.addObject(obj);
    }
  }
  
  getNearbyObjects(x, y, radius, filter = null) {
    const nearby = [];
    const checked = new Set();
    
    // Calculate which cells to check
    const cellRadius = Math.ceil(radius / this.cellSize);
    const centerGridX = Math.floor(x / this.cellSize);
    const centerGridY = Math.floor(y / this.cellSize);
    
    // Check all cells within radius
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        const gridX = centerGridX + dx;
        const gridY = centerGridY + dy;
        
        // Skip cells outside grid bounds
        if (gridX < 0 || gridX >= this.gridSize || 
            gridY < 0 || gridY >= this.gridSize) {
          continue;
        }
        
        const key = `${gridX},${gridY}`;
        const cell = this.grid.get(key);
        
        if (cell) {
          for (const obj of cell) {
            // Avoid duplicates
            const objId = obj.id || obj;
            if (checked.has(objId)) continue;
            checked.add(objId);
            
            // Apply filter if provided
            if (filter && !filter(obj)) continue;
            
            // Check actual distance
            const dx = obj.x - x;
            const dy = obj.y - y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance <= radius + (obj.radius || 0)) {
              nearby.push({
                object: obj,
                distance: distance
              });
            }
          }
        }
      }
    }
    
    // Sort by distance (closest first)
    nearby.sort((a, b) => a.distance - b.distance);
    
    return nearby.map(item => item.object);
  }
  
  getObjectsInCell(x, y) {
    const key = this.getGridKey(x, y);
    const cell = this.grid.get(key);
    return cell ? Array.from(cell) : [];
  }
  
  getCellCount() {
    return this.grid.size;
  }
  
  getObjectCount() {
    let count = 0;
    for (const cell of this.grid.values()) {
      count += cell.size;
    }
    return count;
  }
  
  clear() {
    this.grid.clear();
    this.objectCells.clear();
  }
  
  // Debug: visualize grid occupancy
  getGridStats() {
    const stats = {
      totalCells: this.grid.size,
      totalObjects: this.getObjectCount(),
      cellOccupancy: new Map()
    };
    
    for (const [key, cell] of this.grid) {
      stats.cellOccupancy.set(key, cell.size);
    }
    
    return stats;
  }
}

module.exports = SpatialGrid;