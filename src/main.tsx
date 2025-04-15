import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx' // Update import to .tsx
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render( // Add non-null assertion for getElementById
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)