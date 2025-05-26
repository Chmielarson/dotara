// server/test.js
const express = require('express');
const app = express();
const cors = require('cors');

app.use(cors());
app.use(express.json());

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is working!', timestamp: new Date() });
});

// Test rooms endpoint
app.get('/api/rooms', (req, res) => {
  res.json([]);
});

// Test single room endpoint
app.get('/api/rooms/:id', (req, res) => {
  res.json({
    id: req.params.id,
    test: true,
    message: 'This is a test room'
  });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Test server running on port ${PORT}`);
});