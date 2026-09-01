import { useState, useEffect } from 'react';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';

function App() {
  const [token, setToken] = useState(localStorage.getItem('vendorToken'));

  useEffect(() => {
    if (token) {
      localStorage.setItem('vendorToken', token);
    } else {
      localStorage.removeItem('vendorToken');
    }
  }, [token]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {token ? (
        <Dashboard token={token} setToken={setToken} />
      ) : (
        <Auth setToken={setToken} />
      )}
    </div>
  );
}

export default App;
