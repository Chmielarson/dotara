// server/game/Food.js
let foodIdCounter = 0;

class Food {
  constructor(x, y, mass = 1) {
    this.id = `food_${foodIdCounter++}`;
    this.x = x;
    this.y = y;
    this.mass = mass;
    this.radius = Math.sqrt(mass / Math.PI) * 3;
    this.color = this.generateColor();
    
    // Dla wyrzuconej masy
    this.velocityX = 0;
    this.velocityY = 0;
  }
  
  generateColor() {
    // Losowy jasny kolor
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#F8B500', '#FF6B9D',
      '#C44569', '#44A08D', '#FF8E53', '#7B68EE', '#00CEC9'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }
  
  toJSON() {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      radius: this.radius,
      color: this.color
    };
  }
}

module.exports = Food;