import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../shared/lib/auth/AuthProvider';
import { AppRouter } from './routes/AppRouter';
import '../App.css';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRouter />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
