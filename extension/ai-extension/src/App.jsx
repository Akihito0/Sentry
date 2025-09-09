import { useState } from 'react';
import './App.css';

function App() {
  const [pairingCode, setPairingCode] = useState('');
  const [status, setStatus] = useState('Not Linked');
  const [statusClass, setStatusClass] = useState('');

  const handleLinkDevice = () => {
    // For now, we'll just simulate the linking process.
    // In the future, this will make an API call to your server.
    if (!pairingCode.trim()) {
      setStatus('Please enter a code.');
      setStatusClass('error');
      return;
    }

    setStatus('Linking...');
    setStatusClass('');

    // Simulate a network request
    setTimeout(() => {
      // In a real scenario, you'd check if the code is valid.
      // For now, any code is "valid".
      console.log('Device linked with code:', pairingCode);
      setStatus('Device successfully linked!');
      setStatusClass('success');

      // We would save the pairing code here using chrome.storage
    }, 1500);
  };

  return (
    <div className="app-container">
      <h2>Link to Parent Account</h2>
      <p>Enter the code from the parent dashboard to link this device.</p>
      
      <div className="form-group">
        <input
          type="text"
          className="code-input"
          placeholder="Enter pairing code"
          value={pairingCode}
          onChange={(e) => setPairingCode(e.target.value)}
        />
        <button className="link-button" onClick={handleLinkDevice}>
          Link Device
        </button>
      </div>

      <div className={`status-message ${statusClass}`}>
        {status}
      </div>
    </div>
  );
}

export default App;