#!/usr/bin/env python3
import serial
import time

# Change this to the actual device:
#   - Often /dev/ttyACM0 on Pi for USB GPS
#   - Sometimes /dev/ttyUSB0
PORT = "/dev/ttyUSB0"
BAUD = 9600  # default for the Ultimate GPS

def nmea_to_decimal(coord_str, direction):
    """
    Convert NMEA coordinate format (ddmm.mmmm or dddmm.mmmm) to decimal degrees.
    coord_str: string like '3407.1234' (lat) or '11823.4567' (lon)
    direction: 'N','S','E','W'
    """
    if not coord_str or not direction:
        return None

    # Latitude has 2-degree digits, longitude has 3-degree digits
    if len(coord_str) < 4:
        return None

    if direction in ("N", "S"):
        deg_len = 2
    else:
        deg_len = 3

    try:
        degrees = int(coord_str[:deg_len])
        minutes = float(coord_str[deg_len:])
    except ValueError:
        return None

    decimal = degrees + minutes / 60.0

    if direction in ("S", "W"):
        decimal = -decimal

    return decimal


def main():
    print(f"Opening {PORT} at {BAUD} baud...")
    with serial.Serial(PORT, BAUD, timeout=1) as ser:
        # Give GPS a moment
        time.sleep(2)

        print("Reading NMEA sentences. Press Ctrl+C to stop.\n")
        while True:
            try:
                line = ser.readline().decode("ascii", errors="ignore").strip()
                if not line:
                    continue

                # Print raw NMEA if you want to debug:
                # print(line)

                # Look for RMC (Recommended Minimum) sentences
                if line.startswith("$GPRMC") or line.startswith("$GNRMC"):
                    parts = line.split(",")
                    if len(parts) < 12:
                        continue

                    status = parts[2]  # 'A' = valid, 'V' = void
                    if status != "A":
                        print("No valid fix yet...")
                        continue

                    raw_lat = parts[3]
                    lat_dir = parts[4]
                    raw_lon = parts[5]
                    lon_dir = parts[6]

                    lat = nmea_to_decimal(raw_lat, lat_dir)
                    lon = nmea_to_decimal(raw_lon, lon_dir)

                    # UTC time and date
                    utc_time = parts[1]  # hhmmss.sss
                    utc_date = parts[9]  # ddmmyy

                    print(f"Fix: lat={lat:.6f}, lon={lon:.6f}, "
                          f"UTC time={utc_time}, date={utc_date}")

            except KeyboardInterrupt:
                print("\nStopping.")
                break
            except Exception as e:
                print(f"Error: {e}")
                time.sleep(1)


if __name__ == "__main__":
    main()
