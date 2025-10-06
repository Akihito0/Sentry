import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './css/Dashboard.css'
import App from './components/DashboardView.jsx'
import LandingPage from './components/LandingPage.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {window.location.pathname === '/dashboard' ? <App /> : <LandingPage />}
  </StrictMode>,
)
