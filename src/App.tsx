import { useAuth } from './hooks/useAuth';
import './App.css';

function App() {
  const { user, isAuthenticated, login, logout, isLoading } = useAuth();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div style={{ textAlign: 'center', marginTop: '50px' }}>
      <h1>Nexiom</h1>

      {isAuthenticated ? (
        <div className="card">
          <h2>Welcome back, {user?.name || user?.email}</h2>
          <p>Role: {user?.roles.join(', ') || 'Member'}</p>
          <button onClick={logout}>
            Logout
          </button>
        </div>
      ) : (
        <div className="card">
          <p>Please log in to access your organization.</p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
            <button onClick={() => login('login')}>
              Login
            </button>
            <button onClick={() => login('signup')} style={{ backgroundColor: '#2563eb' }}>
              Sign Up
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
