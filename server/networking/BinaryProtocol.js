// server/networking/BinaryProtocol.js
class BinaryProtocol {
  // Typy pakietów
  static PacketTypes = {
    PLAYER_UPDATE: 1,
    FOOD_UPDATE: 2,
    ENTITY_BATCH: 3,
    GAME_STATE: 4,
    PLAYER_REMOVED: 5,
    LEADERBOARD: 6
  };
  
  // Enkodowanie pozycji gracza
  static encodePlayerUpdate(player) {
    const buffer = Buffer.allocUnsafe(29);
    let offset = 0;
    
    // Type (1 byte)
    buffer.writeUInt8(this.PacketTypes.PLAYER_UPDATE, offset++);
    
    // Player ID hash (4 bytes) - używamy hash zamiast pełnego adresu
    buffer.writeUInt32LE(this.hashString(player.id || player.address), offset);
    offset += 4;
    
    // Position (8 bytes)
    buffer.writeFloatLE(player.x, offset);
    offset += 4;
    buffer.writeFloatLE(player.y, offset);
    offset += 4;
    
    // Radius (4 bytes)
    buffer.writeFloatLE(player.radius, offset);
    offset += 4;
    
    // Mass (4 bytes)
    buffer.writeFloatLE(player.mass, offset);
    offset += 4;
    
    // Color as RGB (3 bytes)
    const rgb = this.colorToRGB(player.color);
    buffer.writeUInt8(rgb.r, offset++);
    buffer.writeUInt8(rgb.g, offset++);
    buffer.writeUInt8(rgb.b, offset++);
    
    // Flags (1 byte)
    const flags = 
      (player.isAlive ? 0x01 : 0) |
      (player.isBoosting ? 0x02 : 0) |
      (player.isMe ? 0x04 : 0);
    buffer.writeUInt8(flags, offset++);
    
    return buffer;
  }
  
  // Enkodowanie batch update dla wielu entity
  static encodeEntityBatch(entities) {
    const headerSize = 5; // type + count
    const entitySize = 24; // per entity
    const buffer = Buffer.allocUnsafe(headerSize + entities.length * entitySize);
    let offset = 0;
    
    // Type
    buffer.writeUInt8(this.PacketTypes.ENTITY_BATCH, offset++);
    
    // Count
    buffer.writeUInt32LE(entities.length, offset);
    offset += 4;
    
    // Entities
    for (const entity of entities) {
      // ID hash (4 bytes)
      buffer.writeUInt32LE(this.hashString(entity.id), offset);
      offset += 4;
      
      // Position (8 bytes)
      buffer.writeFloatLE(entity.x, offset);
      offset += 4;
      buffer.writeFloatLE(entity.y, offset);
      offset += 4;
      
      // Radius (4 bytes)
      buffer.writeFloatLE(entity.radius, offset);
      offset += 4;
      
      // Type and color index (4 bytes)
      const typeColorPacked = (entity.type === 'food' ? 0 : 1) | (entity.colorIndex << 8);
      buffer.writeUInt32LE(typeColorPacked, offset);
      offset += 4;
    }
    
    return buffer;
  }
  
  // Enkodowanie stanu gry
  static encodeGameState(state) {
    const buffer = Buffer.allocUnsafe(21);
    let offset = 0;
    
    // Type
    buffer.writeUInt8(this.PacketTypes.GAME_STATE, offset++);
    
    // Room ID (2 bytes)
    buffer.writeUInt16LE(state.roomId || 0, offset);
    offset += 2;
    
    // Player count (2 bytes)
    buffer.writeUInt16LE(state.playerCount, offset);
    offset += 2;
    
    // Food count (2 bytes)
    buffer.writeUInt16LE(state.foodCount, offset);
    offset += 2;
    
    // Total SOL (8 bytes) - w lamports
    buffer.writeBigUInt64LE(BigInt(state.totalSolInGame || 0), offset);
    offset += 8;
    
    // Map size (4 bytes)
    buffer.writeUInt32LE(state.mapSize, offset);
    offset += 4;
    
    return buffer;
  }
  
  // Enkodowanie leaderboard
  static encodeLeaderboard(leaderboard) {
    const headerSize = 5;
    const entrySize = 16; // per entry
    const maxEntries = Math.min(leaderboard.length, 10);
    const buffer = Buffer.allocUnsafe(headerSize + maxEntries * entrySize);
    let offset = 0;
    
    // Type
    buffer.writeUInt8(this.PacketTypes.LEADERBOARD, offset++);
    
    // Count
    buffer.writeUInt32LE(maxEntries, offset);
    offset += 4;
    
    // Entries
    for (let i = 0; i < maxEntries; i++) {
      const entry = leaderboard[i];
      
      // Player ID hash (4 bytes)
      buffer.writeUInt32LE(this.hashString(entry.address), offset);
      offset += 4;
      
      // SOL value (8 bytes)
      buffer.writeBigUInt64LE(BigInt(entry.solValue || 0), offset);
      offset += 8;
      
      // Zone (1 byte) and rank (1 byte)
      buffer.writeUInt8(entry.zone || 1, offset++);
      buffer.writeUInt8(entry.rank || (i + 1), offset++);
      
      // Padding (2 bytes)
      buffer.writeUInt16LE(0, offset);
      offset += 2;
    }
    
    return buffer;
  }
  
  // Helper: Hash string to 32-bit integer
  static hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
  
  // Helper: Convert color to RGB
  static colorToRGB(color) {
    // Jeśli to jest HSL, konwertuj
    if (color.startsWith('hsl')) {
      const match = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
      if (match) {
        const h = parseInt(match[1]);
        const s = parseInt(match[2]) / 100;
        const l = parseInt(match[3]) / 100;
        const rgb = this.hslToRgb(h, s, l);
        return { r: rgb[0], g: rgb[1], b: rgb[2] };
      }
    }
    
    // Jeśli to jest hex
    if (color.startsWith('#')) {
      const hex = color.replace('#', '');
      return {
        r: parseInt(hex.substr(0, 2), 16),
        g: parseInt(hex.substr(2, 2), 16),
        b: parseInt(hex.substr(4, 2), 16)
      };
    }
    
    // Default
    return { r: 255, g: 255, b: 255 };
  }
  
  // Helper: HSL to RGB conversion
  static hslToRgb(h, s, l) {
    h = h / 360;
    let r, g, b;
    
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
  
  // Dekodowanie (dla klienta)
  static decode(buffer) {
    const type = buffer.readUInt8(0);
    
    switch (type) {
      case this.PacketTypes.PLAYER_UPDATE:
        return this.decodePlayerUpdate(buffer);
      case this.PacketTypes.ENTITY_BATCH:
        return this.decodeEntityBatch(buffer);
      case this.PacketTypes.GAME_STATE:
        return this.decodeGameState(buffer);
      case this.PacketTypes.LEADERBOARD:
        return this.decodeLeaderboard(buffer);
      default:
        throw new Error(`Unknown packet type: ${type}`);
    }
  }
  
  static decodePlayerUpdate(buffer) {
    let offset = 1;
    
    return {
      type: 'player_update',
      id: buffer.readUInt32LE(offset),
      x: buffer.readFloatLE(offset + 4),
      y: buffer.readFloatLE(offset + 8),
      radius: buffer.readFloatLE(offset + 12),
      mass: buffer.readFloatLE(offset + 16),
      color: {
        r: buffer.readUInt8(offset + 20),
        g: buffer.readUInt8(offset + 21),
        b: buffer.readUInt8(offset + 22)
      },
      flags: {
        isAlive: !!(buffer.readUInt8(offset + 23) & 0x01),
        isBoosting: !!(buffer.readUInt8(offset + 23) & 0x02),
        isMe: !!(buffer.readUInt8(offset + 23) & 0x04)
      }
    };
  }
}

module.exports = BinaryProtocol;