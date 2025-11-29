import { useState, useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import './App.css'

function App() {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('')
  const [sseData, setSseData] = useState(null)
  const MAX_SSE_ENTRIES = 100 // Maximum number of entries to keep
  const [sseConnected, setSseConnected] = useState(false)
  
  // Chart refs and instances
  const speedChartRef = useRef(null)
  const rpmChartRef = useRef(null)
  const coolantTempChartRef = useRef(null)
  const throttleChartRef = useRef(null)
  const engineLoadChartRef = useRef(null)
  const fuelLevelChartRef = useRef(null)
  
  const speedChartInstance = useRef(null)
  const rpmChartInstance = useRef(null)
  const coolantTempChartInstance = useRef(null)
  const throttleChartInstance = useRef(null)
  const engineLoadChartInstance = useRef(null)
  const fuelLevelChartInstance = useRef(null)

  // Transform SSE data to uPlot format
  const transformDataForChart = (dataArray, field) => {
    if (!dataArray || dataArray.length === 0) {
      return [[], []]
    }
    
    const times = []
    const values = []
    
    dataArray.forEach((item, index) => {
      // Use index as time if no timestamp, or use actual timestamp if available
      const time = item.timestamp ? new Date(item.timestamp).getTime() / 1000 : index
      const value = item[field]
      
      if (value !== null && value !== undefined && !isNaN(value)) {
        times.push(time)
        values.push(value)
      }
    })
    
    return [times, values]
  }

  // Create or update a chart
  const createOrUpdateChart = (chartRef, chartInstanceRef, dataArray, field, options) => {
    if (!chartRef.current) return
    
    const [times, values] = transformDataForChart(dataArray, field)
    
    if (times.length === 0) return
    
    const chartData = [times, values]
    
    if (chartInstanceRef.current) {
      // Update existing chart
      chartInstanceRef.current.setData(chartData)
    } else {
      // Create new chart - use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        if (!chartRef.current) return
        
        const width = chartRef.current.offsetWidth || 600
        const defaultOptions = {
          width: width,
          height: 200,
          scales: {
            x: {
              time: true,
            },
          },
          series: [
            {},
            {
              label: options.label,
              stroke: options.color || '#667eea',
              width: 2,
              points: {
                show: false,
              },
            },
          ],
          axes: [
            {
              stroke: '#333',
              grid: { show: true, stroke: '#e0e0e0', width: 1 },
              ticks: { show: true, stroke: '#666' },
            },
            {
              stroke: '#333',
              grid: { show: true, stroke: '#e0e0e0', width: 1 },
              ticks: { show: true, stroke: '#666' },
              label: options.label,
              labelSize: 12,
              labelGap: 5,
            },
          ],
        }
        
        try {
          chartInstanceRef.current = new uPlot(defaultOptions, chartData, chartRef.current)
        } catch (error) {
          console.error(`Error creating chart for ${field}:`, error)
        }
      })
    }
  }

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

  // Update charts when SSE data changes
  useEffect(() => {
    if (!sseData || !Array.isArray(sseData) || sseData.length === 0) return
    
    // Create or update each chart
    createOrUpdateChart(speedChartRef, speedChartInstance, sseData, 'speed', {
      label: 'Speed (km/h)',
      color: '#667eea',
    })
    
    createOrUpdateChart(rpmChartRef, rpmChartInstance, sseData, 'rpm', {
      label: 'RPM',
      color: '#e74c3c',
    })
    
    createOrUpdateChart(coolantTempChartRef, coolantTempChartInstance, sseData, 'coolant_temp', {
      label: 'Coolant Temp (°C)',
      color: '#e67e22',
    })
    
    createOrUpdateChart(throttleChartRef, throttleChartInstance, sseData, 'throttle', {
      label: 'Throttle (%)',
      color: '#2ecc71',
    })
    
    createOrUpdateChart(engineLoadChartRef, engineLoadChartInstance, sseData, 'engine_load', {
      label: 'Engine Load (%)',
      color: '#9b59b6',
    })
    
    createOrUpdateChart(fuelLevelChartRef, fuelLevelChartInstance, sseData, 'fuel_level', {
      label: 'Fuel Level (%)',
      color: '#3498db',
    })
  }, [sseData])

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      const charts = [
        { ref: speedChartRef, instance: speedChartInstance },
        { ref: rpmChartRef, instance: rpmChartInstance },
        { ref: coolantTempChartRef, instance: coolantTempChartInstance },
        { ref: throttleChartRef, instance: throttleChartInstance },
        { ref: engineLoadChartRef, instance: engineLoadChartInstance },
        { ref: fuelLevelChartRef, instance: fuelLevelChartInstance },
      ]
      
      charts.forEach(({ ref, instance }) => {
        if (instance.current && ref.current) {
          instance.current.setSize({
            width: ref.current.offsetWidth || 600,
            height: 200,
          })
        }
      })
    }
    
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Cleanup charts on unmount
  useEffect(() => {
    return () => {
      speedChartInstance.current?.destroy()
      rpmChartInstance.current?.destroy()
      coolantTempChartInstance.current?.destroy()
      throttleChartInstance.current?.destroy()
      engineLoadChartInstance.current?.destroy()
      fuelLevelChartInstance.current?.destroy()
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
            <div className="chart-container">
              <h3>Speed</h3>
              <div ref={speedChartRef} className="chart"></div>
            </div>
            
            <div className="chart-container">
              <h3>RPM</h3>
              <div ref={rpmChartRef} className="chart"></div>
            </div>
            
            <div className="chart-container">
              <h3>Coolant Temperature</h3>
              <div ref={coolantTempChartRef} className="chart"></div>
            </div>
            
            <div className="chart-container">
              <h3>Throttle</h3>
              <div ref={throttleChartRef} className="chart"></div>
            </div>
            
            <div className="chart-container">
              <h3>Engine Load</h3>
              <div ref={engineLoadChartRef} className="chart"></div>
            </div>
            
            <div className="chart-container">
              <h3>Fuel Level</h3>
              <div ref={fuelLevelChartRef} className="chart"></div>
            </div>
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

