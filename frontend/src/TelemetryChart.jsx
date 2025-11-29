import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

function TelemetryChart({ title, data, field, label, color = '#667eea' }) {
  const chartRef = useRef(null)
  const chartInstanceRef = useRef(null)

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

  // Create or update chart
  useEffect(() => {
    if (!chartRef.current) return
    if (!data || !Array.isArray(data) || data.length === 0) return
    
    const [times, values] = transformDataForChart(data, field)
    
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
              label: label,
              stroke: color,
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
              label: label,
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
  }, [data, field, label, color])

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (chartInstanceRef.current && chartRef.current) {
        chartInstanceRef.current.setSize({
          width: chartRef.current.offsetWidth || 600,
          height: 200,
        })
      }
    }
    
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Cleanup chart on unmount
  useEffect(() => {
    return () => {
      chartInstanceRef.current?.destroy()
    }
  }, [])

  return (
    <div className="chart-container">
      <h3>{title}</h3>
      <div ref={chartRef} className="chart"></div>
    </div>
  )
}

export default TelemetryChart

