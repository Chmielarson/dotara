// Polyfills dla Solana i Web3
import { Buffer } from 'buffer';
import process from 'process';

window.Buffer = Buffer;
window.process = process;
window.global = window;

// Polyfill dla TextEncoder/TextDecoder jeśli brakuje
if (typeof window.TextEncoder === 'undefined') {
  window.TextEncoder = TextEncoder;
}
if (typeof window.TextDecoder === 'undefined') {
  window.TextDecoder = TextDecoder;
}

// Dodaj BigInt jeśli nie jest dostępny
if (typeof window.BigInt === 'undefined') {
  window.BigInt = function(value) {
    return parseInt(value);
  };
}

console.log('Polyfills loaded successfully');