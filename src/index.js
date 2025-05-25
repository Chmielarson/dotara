// src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// Polyfills dla Solana
import { Buffer } from 'buffer';
window.Buffer = Buffer;

// Disable React StrictMode for production-like behavior
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Performance measuring (optional)
// import reportWebVitals from './reportWebVitals';
// reportWebVitals(console.log);