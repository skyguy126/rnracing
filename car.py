import time
import os
import pathlib
import obd
import requests
from typing import Optional

# Default connection - will auto-detect port or use obdsim if available
# Can be overridden via OBD_PORT environment variable
DEFAULT_PORT = os.getenv("OBD_PORT", None)  # None = auto-detect, or specify like "/dev/ttyUSB0" or "/dev/pts/0" or "/dev/ttys019"
DEFAULT_BAUDRATE = os.getenv("OBD_BAUDRATE", None)  # None = try multiple, or specify like "38400" or "9600"

# Terminal logging toggle - set CAR_LOG_TO_TERMINAL=1 to enable terminal logs
LOG_TO_TERMINAL = os.getenv("CAR_LOG_TO_TERMINAL", "0").lower() in ("1", "true", "yes")

# Ground station server URL - defaults to localhost:500 (matches ground.py default port)
GROUND_STATION_URL = os.getenv("GROUND_STATION_URL", "http://localhost:500")


def connect_obd(port: Optional[str] = None, baudrate: Optional[int] = None) -> Optional[obd.OBD]:
    """
    Connect to OBD-II adapter.
    
    Args:
        port: Serial port path (e.g., "/dev/ttyUSB0" for real hardware,
              "/dev/pts/0" for obdsim, or None for auto-detect)
        baudrate: Serial baudrate (default: 38400, common alternatives: 9600, 115200)
    
    Returns:
        OBD connection object or None if connection failed
    """
    # If port is specified, check if it exists
    if port:
        port_path = pathlib.Path(port)
        if not port_path.exists():
            print(f"[OBD] Port {port} does not exist")
            return None
        
        print(f"[OBD] Attempting to connect to {port}...")
        
        # Give obdsim a moment to initialize if it's a virtual port
        if "ttys" in port or "pts" in port:
            print("[OBD] Waiting for obdsim to initialize...")
            time.sleep(1)
        
        # Try different baudrates if specified, otherwise use defaults
        baudrates_to_try = [baudrate] if baudrate else [38400, 9600, 115200]
        
        for baud in baudrates_to_try:
            try:
                print(f"[OBD] Trying baudrate {baud}...")
                # Try with fast=False first (more compatible with obdsim)
                connection = obd.OBD(port, baudrate=baud, fast=False, timeout=3)
                
                if connection.is_connected():
                    print(f"[OBD] Connected successfully at {baud} baud!")
                    print(f"[OBD] Protocol: {connection.protocol_name()}")
                    print(f"[OBD] Supported commands: {len(connection.supported_commands)}")
                    return connection
                else:
                    print(f"[OBD] Connection established but adapter not responding at {baud} baud")
            except Exception as e:
                print(f"[OBD] Failed at {baud} baud: {e}")
                continue
        
        print("[OBD] Failed to connect with any baudrate")
        return None
    else:
        print("[OBD] Auto-detecting OBD port...")
        try:
            connection = obd.OBD()  # Auto-detect port
            if connection.is_connected():
                print(f"[OBD] Connected successfully!")
                print(f"[OBD] Protocol: {connection.protocol_name()}")
                print(f"[OBD] Supported commands: {len(connection.supported_commands)}")
                return connection
            else:
                print("[OBD] Failed to connect - no ELM327 adapter found")
                return None
        except Exception as e:
            print(f"[OBD] Auto-detect error: {e}")
            return None


def read_obd_data(connection: obd.OBD) -> dict:
    """
    Read common OBD-II data from the connection.
    
    Args:
        connection: OBD connection object
    
    Returns:
        Dictionary of OBD data
    """
    data = {}
    
    # Speed (km/h)
    cmd = obd.commands.SPEED
    response = connection.query(cmd)
    if response.value is not None:
        data['speed'] = response.value.magnitude
    
    # RPM
    cmd = obd.commands.RPM
    response = connection.query(cmd)
    if response.value is not None:
        data['rpm'] = response.value.magnitude
    
    # Engine coolant temperature (°C)
    cmd = obd.commands.COOLANT_TEMP
    response = connection.query(cmd)
    if response.value is not None:
        data['coolant_temp'] = response.value.magnitude
    
    # Throttle position (%)
    cmd = obd.commands.THROTTLE_POS
    response = connection.query(cmd)
    if response.value is not None:
        data['throttle'] = response.value.magnitude
    
    # Engine load (%)
    cmd = obd.commands.ENGINE_LOAD
    response = connection.query(cmd)
    if response.value is not None:
        data['engine_load'] = response.value.magnitude
    
    # Fuel level (%)
    cmd = obd.commands.FUEL_LEVEL
    response = connection.query(cmd)
    if response.value is not None:
        data['fuel_level'] = response.value.magnitude
    
    return data


def main():
    print("Starting CAR node logic...")
    
    # Parse baudrate from environment if provided
    baudrate = int(DEFAULT_BAUDRATE) if DEFAULT_BAUDRATE else None
    
    # Connect to OBD adapter (real hardware or obdsim)
    obd_conn = connect_obd(port=DEFAULT_PORT, baudrate=baudrate)
    
    if obd_conn is None:
        print("[CAR] No OBD connection available. Continuing without OBD data...")
        print("      To use obdsim, see OBD_SIM.md for setup instructions.")
    else:
        print("[CAR] OBD connection established. Reading data...")
        
        # Main loop - read OBD data periodically
        try:
            while True:
                data = read_obd_data(obd_conn)
                if data:
                    # Conditionally print to terminal based on env var
                    if LOG_TO_TERMINAL:
                        print(f"[CAR] OBD Data: {data}")
                    
                    # Send data to ground station
                    try:
                        response = requests.post(
                            f"{GROUND_STATION_URL}/data",
                            json=data,
                            timeout=2
                        )
                        if LOG_TO_TERMINAL:
                            print(f"[CAR] Ground station response: {response.status_code}")
                    except requests.exceptions.RequestException as e:
                        if LOG_TO_TERMINAL:
                            print(f"[CAR] Failed to send data to ground station: {e}")
                else:
                    if LOG_TO_TERMINAL:
                        print("[CAR] No OBD data received")
                
                time.sleep(1)  # Read every second
        except KeyboardInterrupt:
            print("\n[CAR] Shutting down...")
        finally:
            obd_conn.close()
            print("[CAR] OBD connection closed")


if __name__ == "__main__":
    main()
