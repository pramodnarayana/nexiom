import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './shared/lib/auth/AuthProvider'
import { ThemeProvider } from './shared/lib/theme/ThemeProvider'
import './index.css'
import App from './app/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <ThemeProvider defaultTheme="violet-bloom" storageKey="vite-ui-theme-preset">
        <App />
      </ThemeProvider>
    </AuthProvider>
  </StrictMode>,
)
