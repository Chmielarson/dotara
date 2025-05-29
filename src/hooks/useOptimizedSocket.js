// src/hooks/useOptimizedSocket.js
import { useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';

export function useOptimizedSocket(serverUrl) {
  const socketRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectDelay = 1000;
  
  // Inicjalizuj socket z optymalizacjami
  useEffect(() => {
    if (!socketRef.current) {
      socketRef.current = io(serverUrl, {
        reconnection: true,
        reconnectionAttempts: maxReconnectAttempts,
        reconnectionDelay: reconnectDelay,
        reconnectionDelayMax: 5000,
        timeout: 20000,
        transports: ['websocket'], // Tylko websocket dla lepszej wydajności
        // Kompresja
        perMessageDeflate: {
          threshold: 1024 // Kompresuj wiadomości > 1KB
        },
        // Optymalizacje
        forceNew: false,
        multiplex: true,
      });
      
      // Event handlers
      socketRef.current.on('connect', () => {
        console.log('Socket connected');
        reconnectAttempts.current = 0;
      });
      
      socketRef.current.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
      });
      
      socketRef.current.on('reconnect_attempt', (attemptNumber) => {
        console.log(`Reconnection attempt ${attemptNumber}`);
        reconnectAttempts.current = attemptNumber;
      });
      
      socketRef.current.on('reconnect_failed', () => {
        console.error('Failed to reconnect after', maxReconnectAttempts, 'attempts');
      });
    }
    
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [serverUrl]);
  
  // Metoda do wysyłania z retry
  const emit = useCallback((event, data, callback) => {
    if (!socketRef.current || !socketRef.current.connected) {
      console.warn('Socket not connected, queuing event:', event);
      // Możesz dodać kolejkowanie wydarzeń tutaj
      return;
    }
    
    socketRef.current.emit(event, data, callback);
  }, []);
  
  // Metoda do nasłuchiwania z auto-cleanup
  const on = useCallback((event, handler) => {
    if (!socketRef.current) return;
    
    socketRef.current.on(event, handler);
    
    // Return cleanup function
    return () => {
      if (socketRef.current) {
        socketRef.current.off(event, handler);
      }
    };
  }, []);
  
  // Metoda once
  const once = useCallback((event, handler) => {
    if (!socketRef.current) return;
    
    socketRef.current.once(event, handler);
  }, []);
  
  return {
    socket: socketRef.current,
    emit,
    on,
    once,
    connected: socketRef.current?.connected || false,
    reconnectAttempts: reconnectAttempts.current
  };
}