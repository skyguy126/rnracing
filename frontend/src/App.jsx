import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('')
  const [sseData, setSseData] = useState(null)
  const [sseConnected, setSseConnected] = useState(false)

  // Set up Server-Sent Events connection
  useEffect(() => {
    const eventSource = new EventSource('/events')
    
    eventSource.onopen = () => {
      console.log('SSE connection opened')
      setSseConnected(true)
    }
    
    eventSource.onmessage = (event) => {
      try {
        const receivedData = JSON.parse(event.data)
        console.log('Received SSE data:', receivedData)
        setSseData(receivedData)
      } catch (error) {
        console.error('Error parsing SSE data:', error)
      }
    }
    
    eventSource.onerror = (error) => {
      console.error('SSE error:', error)
      setSseConnected(false)
      // EventSource will automatically attempt to reconnect
    }
    
    // Cleanup on unmount
    return () => {
      eventSource.close()
      setSseConnected(false)
    }
  }, [])

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
          <h2>Server-Sent Events</h2>
          <div className={`connection-status ${sseConnected ? 'connected' : 'disconnected'}`}>
            SSE Connection: {sseConnected ? '✓ Connected' : '✗ Disconnected'}
          </div>
          {sseData && (
            <div className="sse-data-section">
              <h3>Real-time Data (via SSE):</h3>
              <pre className="data-display">
                {JSON.stringify(sseData, null, 2)}
              </pre>
            </div>
          )}
        </div>
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

