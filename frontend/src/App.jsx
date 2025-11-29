import { useState, useEffect } from 'react'
import TelemetryChart from './TelemetryChart'
import './App.css'

function App() {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('')
  const [sseData, setSseData] = useState(null)
  const MAX_SSE_ENTRIES = 100 // Maximum number of entries to keep
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
        
        setSseData((prevData) => {
          if (prevData === null) {
            // First message - initialize with received data and add timestamp
            const dataWithTimestamp = Array.isArray(receivedData) 
              ? receivedData.map(item => ({ ...item, timestamp: new Date().toISOString() }))
              : [{ ...receivedData, timestamp: new Date().toISOString() }]
            return dataWithTimestamp
          }
          
          if (Array.isArray(prevData)) {
            // If previous data is an array, append new data with timestamp
            const newDataPoint = Array.isArray(receivedData) 
              ? receivedData.map(item => ({ ...item, timestamp: new Date().toISOString() }))
              : [{ ...receivedData, timestamp: new Date().toISOString() }]
            
            const newData = [...prevData, ...newDataPoint]
            
            // Apply bounded state - keep only the last MAX_SSE_ENTRIES
            return newData.slice(-MAX_SSE_ENTRIES)
          } else {
            // If previous data is an object, convert to array
            const newDataPoint = Array.isArray(receivedData)
              ? receivedData.map(item => ({ ...item, timestamp: new Date().toISOString() }))
              : [{ ...receivedData, timestamp: new Date().toISOString() }]
            
            const newData = [prevData, ...newDataPoint]
            
            // Apply bounded state - keep only the last MAX_SSE_ENTRIES
            return newData.slice(-MAX_SSE_ENTRIES)
          }
        })
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
        <div className="card telemetry-card">
          <h2>Car Telemetry Dashboard</h2>
          <div className={`connection-status ${sseConnected ? 'connected' : 'disconnected'}`}>
            SSE Connection: {sseConnected ? '✓ Connected' : '✗ Disconnected'}
          </div>
          
          <div className="charts-grid">
            <TelemetryChart
              title="Speed"
              data={sseData}
              field="speed"
              label="Speed (km/h)"
              color="#667eea"
            />
            
            <TelemetryChart
              title="RPM"
              data={sseData}
              field="rpm"
              label="RPM"
              color="#e74c3c"
            />
            
            <TelemetryChart
              title="Coolant Temperature"
              data={sseData}
              field="coolant_temp"
              label="Coolant Temp (°C)"
              color="#e67e22"
            />
            
            <TelemetryChart
              title="Throttle"
              data={sseData}
              field="throttle"
              label="Throttle (%)"
              color="#2ecc71"
            />
            
            <TelemetryChart
              title="Engine Load"
              data={sseData}
              field="engine_load"
              label="Engine Load (%)"
              color="#9b59b6"
            />
            
            <TelemetryChart
              title="Fuel Level"
              data={sseData}
              field="fuel_level"
              label="Fuel Level (%)"
              color="#3498db"
            />
          </div>
          
          {sseData && sseData.length > 0 && (
            <div className="sse-data-section">
              <h3>Latest Data Point:</h3>
              <pre className="data-display">
                {JSON.stringify(sseData[sseData.length - 1], null, 2)}
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

