// src/index.js
import './polyfills';
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// Test Solana imports
import { PublicKey } from '@solana/web3.js';
try {
  const testKey = new PublicKey('11111111111111111111111111111111');
  console.log('Solana PublicKey test successful:', testKey.toString());
} catch (error) {
  console.error('Solana PublicKey test failed:', error);
}

// Polyfills dla Solana
import { Buffer } from 'buffer';
window.Buffer = Buffer;
window.global = window;

const root = ReactDOM.createRoot(document.getElementById('root'));
// Removed React.StrictMode to prevent double rendering
root.render(<App />);