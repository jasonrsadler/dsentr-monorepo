import { StrictMode } from 'react'
// Load Stripe.js globally for fraud signals and availability across pages.
// This import inserts the <script src="https://js.stripe.com" /> tag as a side effect.
// It is safe and recommended by Stripe for PCI and fraud detection.
import '@stripe/stripe-js'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './css/globals.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)
