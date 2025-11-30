import time
import sys
import busio
import board
from digitalio import DigitalInOut, Direction, Pull
import adafruit_ssd1306
import adafruit_rfm9x

def display_text(display, text):
    display.fill(0)
    display.text(text, 0, 0, 1)
    display.show()

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

    # main loop
    while True:
        display_text(display, "[CAR] Transmitting...")

        # TODO: collect:
        # - gps data
        # - obd data
        # - ocr tire gauge

        payload = bytes("Button A!\r\n","utf-8")
        rfm9x.send(payload)

        time.sleep(1)
        display_text(display, "[CAR] Ready")
        time.sleep(1)

if __name__ == "__main__":
    main()
