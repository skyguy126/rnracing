import ObdTelemetryDashboard from './ObdTelemetryDashboard'
import GpsMapView from './GpsMapView'
import './App.css'

function App() {
  return (
    <div className="app">
      <main className="app-main">
        <GpsMapView />
        <ObdTelemetryDashboard />
      </main>
    </div>
  )
}

export default App

