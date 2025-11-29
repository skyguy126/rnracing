import { memo, useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import './Map.css'

// Fix for default marker icons in react-leaflet
import L from 'leaflet'
import icon from 'leaflet/dist/images/marker-icon.png'
import iconShadow from 'leaflet/dist/images/marker-shadow.png'

let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
})

L.Marker.prototype.options.icon = DefaultIcon

// Component to update map view when tile source changes
function MapUpdater({ bounds, minZoom, maxZoom }) {
  const map = useMap()
  
  // Fit map to bounds when component mounts or bounds change
  useEffect(() => {
    if (bounds) {
      // Temporarily set zoom limits to ensure fitBounds respects them
      const originalMinZoom = map.getMinZoom()
      const originalMaxZoom = map.getMaxZoom()
      
      if (minZoom !== undefined) {
        map.setMinZoom(minZoom)
      }
      if (maxZoom !== undefined) {
        map.setMaxZoom(maxZoom)
      }
      
      map.fitBounds(bounds, { padding: [20, 20], maxZoom: maxZoom || originalMaxZoom })
      
      // Restore original zoom limits (they're already set on MapContainer, but be safe)
      if (minZoom !== undefined) {
        map.setMinZoom(minZoom)
      }
      if (maxZoom !== undefined) {
        map.setMaxZoom(maxZoom)
      }
    }
  }, [map, bounds, minZoom, maxZoom])
  
  return null
}

const Map = memo(function Map({ tileSource, onTileSourceChange }) {
  // Bounding box coordinates from ISO 19139 - memoized to prevent recalculation
  const bounds = useMemo(() => [
    [38.147370375, -122.468099716], // Southwest [lat, lng]
    [38.1728257839, -122.4458768732] // Northeast [lat, lng]
  ], [])
  
  // Calculate center point - memoized
  const center = useMemo(() => [
    (bounds[0][0] + bounds[1][0]) / 2, // lat
    (bounds[0][1] + bounds[1][1]) / 2  // lng
  ], [bounds])

  // Tile layer URLs - memoized
  // Backend tiles are only available at zoom levels 14-17
  const tileLayers = useMemo(() => ({
    openstreetmap: {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      minZoom: 0,
      maxZoom: 19
    },
    backend: {
      url: '/tiles/{z}/{x}/{y}.png',
      attribution: '&copy; Custom Map Tiles',
      minZoom: 14,
      maxZoom: 17
    }
  }), [])

  const currentTileLayer = tileLayers[tileSource] || tileLayers.openstreetmap

  // Memoize style object to prevent recreation on every render
  const mapStyle = useMemo(() => ({ height: '400px', width: '100%' }), [])
  const boundsOptions = useMemo(() => ({ padding: [20, 20] }), [])

  return (
    <div className="map-container">
      <div className="map-controls">
        <label htmlFor="tile-source-select">Map Tile Source: </label>
        <select
          id="tile-source-select"
          value={tileSource}
          onChange={(e) => onTileSourceChange(e.target.value)}
          className="tile-source-select"
        >
          <option value="openstreetmap">OpenStreetMap</option>
          <option value="backend">Backend Service</option>
        </select>
      </div>
      <MapContainer
        center={center}
        zoom={tileSource === 'backend' ? 15 : 14}
        minZoom={tileSource === 'backend' ? 14 : 0}
        maxZoom={tileSource === 'backend' ? 17 : 19}
        style={mapStyle}
        scrollWheelZoom={true}
        bounds={bounds}
        boundsOptions={boundsOptions}
      >
        <MapUpdater 
          bounds={bounds} 
          minZoom={tileSource === 'backend' ? 14 : undefined}
          maxZoom={tileSource === 'backend' ? 17 : undefined}
        />
        <TileLayer
          url={currentTileLayer.url}
          attribution={currentTileLayer.attribution}
          minZoom={currentTileLayer.minZoom}
          maxZoom={currentTileLayer.maxZoom}
        />
      </MapContainer>
    </div>
  )
})

export default Map

