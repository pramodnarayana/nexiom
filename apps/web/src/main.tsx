import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from 'react-oidc-context'
import './index.css'
import App from './App.tsx'

const oidcConfig = {
  authority: import.meta.env.VITE_ZITADEL_AUTHORITY || 'https://issuer.zitadel.ch',
  client_id: import.meta.env.VITE_ZITADEL_CLIENT_ID || 'your-client-id',
  redirect_uri: 'http://localhost:5173/',
  scope: 'openid profile email urn:zitadel:iam:org:project:id:zitadel:aud',
  onSigninCallback: () => {
    // Remove query string after login
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider {...oidcConfig}>
      <App />
    </AuthProvider>
  </StrictMode>,
)
