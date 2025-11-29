import time
import os
import json
import pathlib
import math
import requests
from typing import Optional, List, Tuple
from datetime import datetime

# Default route file - can be overridden via GPS_ROUTE_FILE environment variable
# If not specified, will use the first .json file found in sim_gps_routes directory
DEFAULT_ROUTE_FILE = os.getenv("GPS_ROUTE_FILE", None)

# Terminal logging toggle - set GPS_LOG_TO_TERMINAL=1 to enable terminal logs
LOG_TO_TERMINAL = os.getenv("GPS_LOG_TO_TERMINAL", "0").lower() in ("1", "true", "yes")

# Ground station server URL - uses PORT env var or defaults to port 5000
GROUND_STATION_URL = os.getenv("GROUND_STATION_URL") or f"http://localhost:{os.getenv('PORT', '5000')}"

# Speed multiplier for simulation (meters per second)
# Default: 30 m/s = ~67 mph = ~108 km/h
SPEED_MULTIPLIER = float(os.getenv("GPS_SPEED_MULTIPLIER", "30.0"))


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great circle distance between two points on Earth (in meters).
    
    Args:
        lat1, lon1: Latitude and longitude of first point in decimal degrees
        lat2, lon2: Latitude and longitude of second point in decimal degrees
    
    Returns:
        Distance in meters
    """
    # Earth's radius in meters
    R = 6371000
    
    # Convert to radians
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    # Haversine formula
    a = math.sin(delta_phi / 2) ** 2 + \
        math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    
    return R * c


def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the bearing (heading) from point 1 to point 2.
    
    Args:
        lat1, lon1: Latitude and longitude of first point in decimal degrees
        lat2, lon2: Latitude and longitude of second point in decimal degrees
    
    Returns:
        Bearing in degrees (0-360, where 0 is North)
    """
    # Convert to radians
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_lambda = math.radians(lon2 - lon1)
    
    # Calculate bearing
    y = math.sin(delta_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - \
        math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda)
    
    # Convert to degrees and normalize to 0-360
    bearing = math.degrees(math.atan2(y, x))
    return (bearing + 360) % 360


def load_geojson_route(file_path: str) -> List[Tuple[float, float]]:
    """
    Load a GeoJSON file and extract coordinates from LineString features.
    
    Args:
        file_path: Path to the GeoJSON file
    
    Returns:
        List of (latitude, longitude) tuples
    """
    with open(file_path, 'r') as f:
        geojson = json.load(f)
    
    coordinates = []
    
    if geojson.get('type') == 'FeatureCollection':
        for feature in geojson.get('features', []):
            if feature.get('geometry', {}).get('type') == 'LineString':
                # GeoJSON coordinates are [longitude, latitude]
                coords = feature['geometry']['coordinates']
                for lon, lat in coords:
                    coordinates.append((lat, lon))
    elif geojson.get('type') == 'Feature':
        if geojson.get('geometry', {}).get('type') == 'LineString':
            coords = geojson['geometry']['coordinates']
            for lon, lat in coords:
                coordinates.append((lat, lon))
    elif geojson.get('type') == 'LineString':
        coords = geojson.get('coordinates', [])
        for lon, lat in coords:
            coordinates.append((lat, lon))
    
    return coordinates


def find_route_file() -> Optional[str]:
    """
    Find a route file to use. Checks:
    1. GPS_ROUTE_FILE environment variable
    2. First .json file in sim_gps_routes directory
    
    Returns:
        Path to route file or None if not found
    """
    if DEFAULT_ROUTE_FILE:
        route_path = pathlib.Path(DEFAULT_ROUTE_FILE)
        if route_path.exists():
            return str(route_path)
        print(f"[GPS] Specified route file not found: {DEFAULT_ROUTE_FILE}")
    
    # Look for .json files in sim_gps_routes directory
    routes_dir = pathlib.Path(__file__).parent.parent / "sim_gps_routes"
    if routes_dir.exists():
        json_files = list(routes_dir.glob("*.json"))
        if json_files:
            return str(json_files[0])
    
    return None


def simulate_gps_data(coordinates: List[Tuple[float, float]]) -> None:
    """
    Simulate GPS data by iterating through coordinates and sending to ground station.
    
    Args:
        coordinates: List of (latitude, longitude) tuples
    """
    if not coordinates:
        print("[GPS] No coordinates found in route file")
        return
    
    print(f"[GPS] Starting simulation with {len(coordinates)} waypoints")
    
    try:
        for i in range(len(coordinates)):
            lat, lon = coordinates[i]
            
            # Calculate heading (bearing to next point)
            heading = None
            if i < len(coordinates) - 1:
                next_lat, next_lon = coordinates[i + 1]
                heading = calculate_bearing(lat, lon, next_lat, next_lon)
            
            # Calculate speed based on distance to next point
            speed = None
            if i < len(coordinates) - 1:
                next_lat, next_lon = coordinates[i + 1]
                distance_meters = haversine_distance(lat, lon, next_lat, next_lon)
                # Speed = distance / time, where time = 1 second
                speed = distance_meters / 1.0  # meters per second
                # Apply speed multiplier if set
                speed = speed * (SPEED_MULTIPLIER / 30.0) if SPEED_MULTIPLIER != 30.0 else speed
                # Convert to km/h for display (optional, but common unit)
                speed_kmh = speed * 3.6
            
            # Create GPS data object matching gpsDataSchema
            gps_data = {
                'type': 'gps',
                'latitude': lat,
                'longitude': lon,
                'timestamp': datetime.utcnow().isoformat() + 'Z',
            }
            
            # Add optional fields if available
            if heading is not None:
                gps_data['heading'] = heading
            if speed is not None:
                gps_data['speed'] = speed  # meters per second
            
            # Conditionally print to terminal
            if LOG_TO_TERMINAL:
                speed_str = f" ({speed_kmh:.1f} km/h)" if speed is not None else ""
                heading_str = f", heading: {heading:.1f}°" if heading is not None else ""
                print(f"[GPS] Waypoint {i+1}/{len(coordinates)}: "
                      f"lat={lat:.6f}, lon={lon:.6f}{speed_str}{heading_str}")
            
            # Send data to ground station
            try:
                response = requests.post(
                    f"{GROUND_STATION_URL}/data",
                    json=gps_data,
                    timeout=2
                )
                if LOG_TO_TERMINAL:
                    print(f"[GPS] Ground station response: {response.status_code}")
            except requests.exceptions.RequestException as e:
                if LOG_TO_TERMINAL:
                    print(f"[GPS] Failed to send data to ground station: {e}")
            
            # Wait 1 second before next waypoint (except for last one)
            if i < len(coordinates) - 1:
                time.sleep(1)
    
    except KeyboardInterrupt:
        print("\n[GPS] Simulation interrupted by user")
    except Exception as e:
        print(f"[GPS] Error during simulation: {e}")
        raise


def main():
    print("Starting GPS SIMULATOR...")
    
    # Find route file
    route_file = find_route_file()
    if route_file is None:
        print("[GPS] No route file found. Please:")
        print("      1. Set GPS_ROUTE_FILE environment variable, or")
        print("      2. Place a .json GeoJSON file in sim_gps_routes/ directory")
        return
    
    print(f"[GPS] Loading route from: {route_file}")
    
    # Load coordinates from GeoJSON
    try:
        coordinates = load_geojson_route(route_file)
    except Exception as e:
        print(f"[GPS] Failed to load route file: {e}")
        return
    
    if not coordinates:
        print("[GPS] No coordinates found in route file")
        return
    
    print(f"[GPS] Loaded {len(coordinates)} waypoints")
    print(f"[GPS] Starting simulation (1 waypoint per second)")
    print(f"[GPS] Ground station URL: {GROUND_STATION_URL}")
    print(f"[GPS] Speed multiplier: {SPEED_MULTIPLIER} m/s")
    print(f"[GPS] Press Ctrl+C to stop\n")
    
    # Run simulation in a loop (restart from beginning when done)
    try:
        while True:
            simulate_gps_data(coordinates)
            print("\n[GPS] Route completed. Restarting from beginning...\n")
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[GPS] Shutting down...")


if __name__ == "__main__":
    main()

