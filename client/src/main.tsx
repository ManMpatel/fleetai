import { Auth0Provider } from '@auth0/auth0-react'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import axios from 'axios'

axios.defaults.baseURL = import.meta.env.VITE_API_URL || 'http://localhost:5000'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Auth0Provider
      domain="fleetai.au.auth0.com"
      clientId="hEdjJkTAMPQu9ZftTStkr94Mey9a5Ht2"
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: 'https://fleetai-production.up.railway.app'
      }}
    >
      <App />
    </Auth0Provider>
  </React.StrictMode>
)