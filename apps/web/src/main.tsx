import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './lib/auth/AuthProvider'
import { ThemeProvider } from './lib/theme/ThemeProvider'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <ThemeProvider defaultTheme="bold-tech" storageKey="vite-ui-theme-preset">
        <App />
      </ThemeProvider>
    </AuthProvider>
  </StrictMode>,
)
