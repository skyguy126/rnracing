import { useState } from 'react'
import './App.css'

function App() {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('')

  const sendTestData = async () => {
    try {
      const response = await fetch('/data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          test: true,
          timestamp: new Date().toISOString(),
          message: 'Hello from React frontend!',
        }),
      })
      const result = await response.json()
      setData(result)
      setStatus(response.ok ? 'success' : 'error')
    } catch (error) {
      setStatus('error')
      setData({ error: error.message })
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>RN Racing Ground Station</h1>
        <p>Real-time data monitoring and control</p>
      </header>
      <main className="app-main">
        <div className="card">
          <h2>Data Endpoint Test</h2>
          <button onClick={sendTestData} className="test-button">
            Send Test Data
          </button>
          {status && (
            <div className={`status ${status}`}>
              Status: {status === 'success' ? '✓ Success' : '✗ Error'}
            </div>
          )}
          {data && (
            <pre className="data-display">
              {JSON.stringify(data, null, 2)}
            </pre>
          )}
        </div>
      </main>
    </div>
  )
}

export default App

