// src/components/CashOutScreen.js
import React, { useState, useEffect } from 'react';
import { cashOut } from '../utils/SolanaTransactions';
import './CashOutScreen.css';

export default function CashOutScreen({ pendingCashOut, wallet, onComplete }) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [txSignature, setTxSignature] = useState('');
  
  // Zabezpieczenie przed brakiem danych
  if (!pendingCashOut || !pendingCashOut.amount) {
    return (
      <div className="cashout-screen">
        <div className="cashout-container">
          <h1>Error</h1>
          <p>No pending cash out found. Redirecting...</p>
          {setTimeout(() => onComplete(), 2000)}
        </div>
      </div>
    );
  }
  
  // Formatuj SOL
  const formatSol = (lamports) => {
    return (lamports / 1000000000).toFixed(4);
  };
  
  const amountSol = formatSol(pendingCashOut.amount);
  const platformFee = (amountSol * 0.05).toFixed(4);
  const playerReceives = (amountSol * 0.95).toFixed(4);
  
  // Zapobiegaj cofnięciu lub odświeżeniu
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = 'You have a pending cash out. Are you sure you want to leave?';
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);
  
  const handleCashOut = async () => {
    try {
      setIsProcessing(true);
      setError('');
      
      const result = await cashOut(wallet);
      
      setTxSignature(result.signature);
      
      // Poczekaj chwilę żeby użytkownik zobaczył sukces
      setTimeout(() => {
        onComplete();
      }, 3000);
      
    } catch (error) {
      console.error('Cash out error:', error);
      setError(error.message || 'Failed to process cash out');
      setIsProcessing(false);
    }
  };
  
  return (
    <div className="cashout-screen">
      <div className="cashout-container">
        <h1>💰 Cash Out</h1>
        
        {!txSignature ? (
          <>
            <div className="cashout-info">
              <h2>You are safely removed from the game</h2>
              <p>Your funds are secured and ready to withdraw</p>
              
              <div className="amount-breakdown">
                <div className="amount-row">
                  <span>Your balance:</span>
                  <span className="amount">{amountSol} SOL</span>
                </div>
                <div className="amount-row">
                  <span>Platform fee (5%):</span>
                  <span className="fee">-{platformFee} SOL</span>
                </div>
                <div className="amount-row total">
                  <span>You will receive:</span>
                  <span className="total-amount">{playerReceives} SOL</span>
                </div>
              </div>
              
              <div className="warning-box">
                <p>⚠️ Do not close this window until the transaction is complete!</p>
              </div>
            </div>
            
            {error && (
              <div className="error-message">
                {error}
              </div>
            )}
            
            <button 
              className="cashout-btn"
              onClick={handleCashOut}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <div className="spinner"></div>
                  Processing Transaction...
                </>
              ) : (
                'Withdraw SOL to Wallet'
              )}
            </button>
          </>
        ) : (
          <div className="success-screen">
            <h2>✅ Cash Out Successful!</h2>
            <p className="success-amount">You received {playerReceives} SOL</p>
            <p className="tx-signature">
              Transaction: {txSignature.substring(0, 20)}...
            </p>
            <p className="redirect-info">Redirecting to main menu...</p>
          </div>
        )}
      </div>
    </div>
  );
}