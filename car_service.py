import time
import sys
import serial
import busio
import board
from digitalio import DigitalInOut, Direction, Pull
import adafruit_ssd1306
import adafruit_rfm9x

GPS_PORT = "/dev/ttyUSB0"
GPS_BAUD = 9600

def nmea_to_decimal(coord_str, direction):
    if not coord_str or not direction or len(coord_str) < 4:
        return None

    deg_len = 2 if direction in ("N", "S") else 3

    try:
        degrees = int(coord_str[:deg_len])
        minutes = float(coord_str[deg_len:])
    except ValueError:
        return None

    decimal = degrees + minutes / 60.0
    if direction in ("S", "W"):
        decimal = -decimal
    return decimal


def fetch_gps_coordinates(timeout_sec=3):
    """Read a single GPS fix; return (lat, lon) or (0, 0) on failure."""
    try:
        with serial.Serial(GPS_PORT, GPS_BAUD, timeout=1) as ser:
            ser.reset_input_buffer()
            deadline = time.time() + timeout_sec
            while time.time() < deadline:
                line = ser.readline().decode("ascii", errors="ignore").strip()
                if not line:
                    continue
                if not (line.startswith("$GPRMC") or line.startswith("$GNRMC")):
                    continue

                parts = line.split(",")
                if len(parts) < 12 or parts[2] != "A":
                    continue

                lat = nmea_to_decimal(parts[3], parts[4])
                lon = nmea_to_decimal(parts[5], parts[6])
                if lat is not None and lon is not None:
                    return lat, lon
    except Exception as exc:
        print(f"[GPS] Error acquiring fix: {exc}")

    return 0.0, 0.0


def display_text(display, text):
    display.fill(0)
    display.text(text, 0, 0, 1)
    display.show()


def blank_display(display):
    """Clear and, if available, power down the panel."""
    if display is None:
        return
    display.fill(0)
    display.show()
    if hasattr(display, "poweroff"):
        display.poweroff()

def main():   
    # Create the I2C interface.
    i2c = busio.I2C(board.SCL, board.SDA)

    # 128x32 OLED Display
    reset_pin = DigitalInOut(board.D4)
    display = adafruit_ssd1306.SSD1306_I2C(128, 32, i2c, reset=reset_pin)
    
    # Clear the display.
    width = display.width
    height = display.height

    display_text(display, "[CAR] Starting...")
    print("[CAR] Starting...")
    time.sleep(1)

    # Configure RFM9x LoRa Radio
    CS = DigitalInOut(board.CE1)
    RESET = DigitalInOut(board.D25)
    spi = busio.SPI(board.SCK, MOSI=board.MOSI, MISO=board.MISO)

    # Attempt to set up the RFM9x Module
    try:
        rfm9x = adafruit_rfm9x.RFM9x(spi, CS, RESET, 915.0)
        rfm9x.tx_power = 20 # max is 23 but module can overheat

        display_text(display, "[CAR] RFM9x: Detected")
        print("[CAR] RFM9x: Detected")
        time.sleep(1)
    except RuntimeError as error:
        # Thrown on version mismatch
        display_text(display, "[CAR] RFM9x: ERROR")
        print('RFM9x Error: ', error)
        sys.exit(-1)

    display_text(display, "[CAR] Ready")
    print("[CAR] Ready")
    time.sleep(1)

    try:
        # main loop
        while True:
            # TODO: collect:
            # - gps data
            # - obd data
            # - ocr tire gauge

            lat, lon = fetch_gps_coordinates()
            print(f"[GPS] fix lat={lat}, lon={lon}")

            display_text(display, "[CAR] Transmitting...")

            payload = bytes("test\r\n","utf-8")
            rfm9x.send(payload)

            time.sleep(1)

            display_text(display, "[CAR] Ready")

            time.sleep(1)
    except KeyboardInterrupt:
        print("[CAR] Shutdown requested by user, blanking display.")
    finally:
        blank_display(display)

if __name__ == "__main__":
    main()
