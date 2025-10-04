import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './components/ModalBase.css';
import App from './App';
import { AuthProvider } from "./context/AuthContext";
import { ServerProvider } from "./context/ServerContext";

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  
    <AuthProvider>
      <ServerProvider>
        <App />
      </ServerProvider>
    </AuthProvider>
  
);

