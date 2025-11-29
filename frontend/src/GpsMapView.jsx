import { useState, useEffect } from 'react'
import Map from './Map'
import { validateGpsData } from './telemetrySchema'
import './App.css'

function GpsMapView() {
  const [gpsData, setGpsData] = useState(null)
  const [sseConnected, setSseConnected] = useState(false)
  const [tileSource, setTileSource] = useState('backend')

  // Set up Server-Sent Events connection for GPS data
  useEffect(() => {
    const eventSource = new EventSource('/events')
    
    eventSource.onopen = () => {
      console.log('SSE connection opened (GPS Map View)')
      setSseConnected(true)
    }
    
    eventSource.onmessage = (event) => {
      try {
        const receivedData = JSON.parse(event.data)
        
        // Filter for GPS data type only
        const processDataItem = (item) => {
          // Skip connection messages
          if (item.type === 'connected') {
            return null
          }
          
          // Only process GPS data
          if (item.type !== 'gps') {
            return null
          }
          
          // Validate GPS data using schema
          const validated = validateGpsData(item)
          
          // If validation failed or required fields are missing, skip
          if (!validated || validated.latitude === undefined || validated.longitude === undefined) {
            return null
          }
          
          // Ensure timestamp is present (add if missing)
          if (!validated.timestamp) {
            validated.timestamp = new Date().toISOString()
          }
          
          return validated
        }
        
        setGpsData((prevData) => {
          // Process received data
          const processedItems = Array.isArray(receivedData) 
            ? receivedData.map(processDataItem).filter(item => item !== null)
            : (() => {
                const processed = processDataItem(receivedData)
                return processed ? [processed] : []
              })()
          
          if (processedItems.length === 0) {
            return prevData // No GPS data in this message
          }
          
          // For GPS, we typically want the latest position, but keep history for trail
          // Keep last 1000 points for trail rendering
          const MAX_GPS_POINTS = 1000
          
          if (prevData === null) {
            return processedItems
          }
          
          if (Array.isArray(prevData)) {
            const newData = [...prevData, ...processedItems]
            return newData.slice(-MAX_GPS_POINTS)
          } else {
            const newData = [prevData, ...processedItems]
            return newData.slice(-MAX_GPS_POINTS)
          }
        })
      } catch (error) {
        console.error('Error parsing SSE data (GPS Map View):', error)
      }
    }
    
    eventSource.onerror = (error) => {
      console.error('SSE error (GPS Map View):', error)
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
    <div className="card map-card">
      <h2>Track Map</h2>
      <div className={`connection-status ${sseConnected ? 'connected' : 'disconnected'}`}>
        GPS Connection: {sseConnected ? '✓ Connected' : '✗ Disconnected'}
      </div>
      <Map 
        tileSource={tileSource} 
        onTileSourceChange={setTileSource}
        gpsData={gpsData}
      />
    </div>
  )
}

export default GpsMapView

