import { useState, useEffect } from 'react'
import TelemetryChart from './TelemetryChart'
import { validateTelemetryData } from './telemetrySchema'
import './App.css'

const MAX_SSE_ENTRIES = 100 // Maximum number of entries to keep

function ObdTelemetryDashboard() {
  const [obdData, setObdData] = useState(null)
  const [sseConnected, setSseConnected] = useState(false)

  // Set up Server-Sent Events connection for OBD data
  useEffect(() => {
    const eventSource = new EventSource('/events')
    
    eventSource.onopen = () => {
      console.log('SSE connection opened (OBD Dashboard)')
      setSseConnected(true)
    }
    
    eventSource.onmessage = (event) => {
      try {
        const receivedData = JSON.parse(event.data)
        
        // Filter for OBD data type only
        const processDataItem = (item) => {
          // Skip connection messages
          if (item.type === 'connected') {
            return null
          }
          
          // Only process OBD data
          if (item.type !== 'obd') {
            return null
          }
          
          const validated = validateTelemetryData(item)
          return { ...validated, timestamp: new Date().toISOString() }
        }
        
        setObdData((prevData) => {
          // Process received data
          const processedItems = Array.isArray(receivedData) 
            ? receivedData.map(processDataItem).filter(item => item !== null)
            : (() => {
                const processed = processDataItem(receivedData)
                return processed ? [processed] : []
              })()
          
          if (processedItems.length === 0) {
            return prevData // No OBD data in this message
          }
          
          if (prevData === null) {
            // First message - initialize with received data
            return processedItems
          }
          
          if (Array.isArray(prevData)) {
            // Append new data
            const newData = [...prevData, ...processedItems]
            // Apply bounded state - keep only the last MAX_SSE_ENTRIES
            return newData.slice(-MAX_SSE_ENTRIES)
          } else {
            // If previous data is an object, convert to array
            const newData = [prevData, ...processedItems]
            // Apply bounded state - keep only the last MAX_SSE_ENTRIES
            return newData.slice(-MAX_SSE_ENTRIES)
          }
        })
      } catch (error) {
        console.error('Error parsing SSE data (OBD Dashboard):', error)
      }
    }
    
    eventSource.onerror = (error) => {
      console.error('SSE error (OBD Dashboard):', error)
      setSseConnected(false)
      // EventSource will automatically attempt to reconnect
    }
    
    // Cleanup on unmount
    return () => {
      eventSource.close()
      setSseConnected(false)
    }
  }, [])

  return (
    <div className="card telemetry-card">
      <h2>Car Telemetry Dashboard</h2>
      <div className={`connection-status ${sseConnected ? 'connected' : 'disconnected'}`}>
        SSE Connection: {sseConnected ? '✓ Connected' : '✗ Disconnected'}
      </div>
      
      <div className="charts-grid">
        <TelemetryChart
          title="Speed"
          data={obdData}
          field="speed"
          label="Speed (km/h)"
          color="#667eea"
        />
        
        <TelemetryChart
          title="RPM"
          data={obdData}
          field="rpm"
          label="RPM"
          color="#e74c3c"
        />
        
        <TelemetryChart
          title="Coolant Temperature"
          data={obdData}
          field="coolant_temp"
          label="Coolant Temp (°C)"
          color="#e67e22"
        />
        
        <TelemetryChart
          title="Throttle"
          data={obdData}
          field="throttle"
          label="Throttle (%)"
          color="#2ecc71"
        />
        
        <TelemetryChart
          title="Engine Load"
          data={obdData}
          field="engine_load"
          label="Engine Load (%)"
          color="#9b59b6"
        />
        
        <TelemetryChart
          title="Fuel Level"
          data={obdData}
          field="fuel_level"
          label="Fuel Level (%)"
          color="#3498db"
        />
      </div>
      
      {obdData && obdData.length > 0 && (
        <div className="sse-data-section">
          <h3>Latest Data Point:</h3>
          <pre className="data-display">
            {JSON.stringify(obdData[obdData.length - 1], null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

export default ObdTelemetryDashboard

