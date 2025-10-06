import React from 'react'
import ReactDOM from 'react-dom/client'
import LandingPage from './components/LandingPage.jsx'
import App from './components/App'
import './css/index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.location.pathname === '/dashboard' ? <App /> : <LandingPage />}
  </React.StrictMode>
)



