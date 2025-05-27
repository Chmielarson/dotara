// src/components/Chat.js
import React, { useState, useEffect, useRef } from 'react';
import './Chat.css';

export default function Chat({ socket, playerAddress }) {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true); // Domyślnie rozwinięty
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  
  useEffect(() => {
    scrollToBottom();
  }, [messages]);
  
  useEffect(() => {
    if (!socket || !playerAddress) return;
    
    // Join lobby
    socket.emit('join_lobby', { playerAddress });
    setIsConnected(true);
    
    // Listen for chat history
    socket.on('chat_history', (history) => {
      setMessages(history);
    });
    
    // Listen for new messages
    socket.on('new_chat_message', (message) => {
      setMessages(prev => [...prev, message]);
      
      // Jeśli chat jest zwinięty, zwiększ licznik nieprzeczytanych
      if (!isExpanded) {
        setUnreadCount(prev => prev + 1);
      }
    });
    
    return () => {
      socket.emit('leave_lobby');
      socket.off('chat_history');
      socket.off('new_chat_message');
      setIsConnected(false);
    };
  }, [socket, playerAddress, isExpanded]);
  
  // Resetuj licznik nieprzeczytanych gdy chat zostanie rozwinięty
  useEffect(() => {
    if (isExpanded) {
      setUnreadCount(0);
    }
  }, [isExpanded]);
  
  const sendMessage = (e) => {
    e.preventDefault();
    
    if (!inputMessage.trim() || !socket || !isConnected) return;
    
    socket.emit('chat_message', {
      playerAddress,
      message: inputMessage
    });
    
    setInputMessage('');
  };
  
  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };
  
  const formatAddress = (address) => {
    return `${address.substring(0, 4)}...${address.substring(address.length - 4)}`;
  };
  
  const toggleChat = () => {
    setIsExpanded(!isExpanded);
  };
  
  return (
    <div className={`chat-wrapper ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div className="chat-toggle" onClick={toggleChat}>
        <div className="toggle-content">
          {isExpanded ? (
            <>
              <span className="toggle-icon">→</span>
              <span className="toggle-text">Hide</span>
            </>
          ) : (
            <>
              <span className="toggle-icon">←</span>
              <span className="toggle-text">Chat</span>
              {unreadCount > 0 && (
                <span className="unread-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
              )}
            </>
          )}
        </div>
      </div>
      
      <div className="chat-container">
        <div className="chat-header">
          <h3>Global Chat</h3>
          <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '● Online' : '○ Offline'}
          </div>
        </div>
        
        <div className="chat-messages" ref={chatContainerRef}>
          {messages.length === 0 ? (
            <div className="no-messages">
              <p>No messages yet. Say hello!</p>
            </div>
          ) : (
            messages.map((msg) => (
              <div 
                key={msg.id} 
                className={`chat-message ${msg.playerAddress === playerAddress ? 'own-message' : ''}`}
              >
                <div className="message-header">
                  <span className="message-author">
                    {formatAddress(msg.playerAddress)}
                    {msg.playerAddress === playerAddress && ' (You)'}
                  </span>
                  <span className="message-time">{formatTime(msg.timestamp)}</span>
                </div>
                <div className="message-content">{msg.message}</div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
        
        <form className="chat-input-form" onSubmit={sendMessage}>
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder={isConnected ? "Type a message..." : "Connect wallet to chat"}
            maxLength={200}
            disabled={!isConnected || !playerAddress}
            className="chat-input"
          />
          <button 
            type="submit" 
            disabled={!isConnected || !inputMessage.trim() || !playerAddress}
            className="chat-send-btn"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}