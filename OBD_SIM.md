# OBD Simulator (obdsim) Setup and Usage Guide

This guide explains how to set up and use `obdsim` to simulate OBD-II data for development and testing when you're away from your car.

## What is obdsim?

`obdsim` is a virtual OBD-II adapter simulator that creates a virtual serial port and responds to OBD-II commands just like a real ELM327 adapter would. This allows you to develop and test your OBD data collection code without needing physical access to a car.

## Installation

### macOS

On macOS, you can install obdsim using Homebrew:

```bash
brew install obdsim
```

If Homebrew doesn't have it, you can compile from source:

```bash
# Install dependencies
brew install libusb

# Clone and build obdsim
git clone https://github.com/icotting/obdsim.git
cd obdsim
make
sudo make install
```

### Linux (Ubuntu/Debian)

```bash
# Install dependencies
sudo apt-get update
sudo apt-get install libusb-1.0-0-dev build-essential

# Clone and build obdsim
git clone https://github.com/icotting/obdsim.git
cd obdsim
make
sudo make install
```

### Alternative: Using Docker

If you prefer not to install obdsim directly, you can use a Docker container:

```bash
docker run -it --rm -p 35000:35000 -p 35001:35001 \
  --device=/dev/ttyUSB0 \
  icotting/obdsim
```

## Starting obdsim

### Basic Usage

Start obdsim with a virtual serial port:

```bash
obdsim -g gui_fltk
```

This will:
- Create a virtual serial port (typically `/dev/pts/0` on Linux or `/dev/ttysXXX` on macOS)
- Open a GUI window showing simulated vehicle data
- Respond to OBD-II commands on the virtual port

### Finding the Virtual Port

After starting obdsim, you need to identify the virtual serial port it created:

**On Linux:**
```bash
# List pseudo-terminals
ls -l /dev/pts/
# Look for the newest one, usually /dev/pts/0 or /dev/pts/1
```

**On macOS:**
```bash
# List serial ports
ls -l /dev/tty.*
# Look for a new tty device, often /dev/ttys000 or similar
```

### Starting obdsim with a Specific Port

You can also specify a port explicitly:

```bash
# Linux
obdsim -g gui_fltk -s /dev/pts/0

# macOS
obdsim -g gui_fltk -s /dev/ttys000
```

### Headless Mode (No GUI)

If you don't need the GUI, you can run obdsim in headless mode:

```bash
obdsim -g gui_none
```

## Using obdsim with python-obd

### Option 1: Auto-detect (Recommended)

The `car.py` script will auto-detect the OBD port. If obdsim is running, it should find it automatically:

```bash
# Terminal 1: Start obdsim
obdsim -g gui_fltk

# Terminal 2: Run your car script
python car.py
```

### Option 2: Specify Port Explicitly

If auto-detection doesn't work, you can specify the port in `car.py`:

```python
# In car.py, change DEFAULT_PORT:
DEFAULT_PORT = "/dev/pts/0"  # Linux
# or
DEFAULT_PORT = "/dev/ttys000"  # macOS
```

Then run:
```bash
python car.py
```

## obdsim GUI Controls

When running with `-g gui_fltk`, the obdsim GUI provides:

- **Speed control**: Adjust simulated vehicle speed
- **RPM control**: Adjust simulated engine RPM
- **Temperature controls**: Adjust coolant and intake air temperatures
- **Fuel level**: Adjust simulated fuel level
- **Throttle position**: Adjust throttle percentage
- **Other parameters**: Various other OBD-II parameters

You can interact with these controls to simulate different driving conditions.

## Common obdsim Commands

```bash
# Start with GUI
obdsim -g gui_fltk

# Start headless
obdsim -g gui_none

# Start with specific baud rate
obdsim -g gui_fltk -b 38400

# Start with specific port
obdsim -g gui_fltk -s /dev/pts/0

# Show help
obdsim --help
```

## Troubleshooting

### Port Not Found

If python-obd can't find the port:

1. **Check if obdsim is running:**
   ```bash
   ps aux | grep obdsim
   ```

2. **List available serial ports:**
   ```bash
   # Linux
   ls -l /dev/pts/
   
   # macOS
   ls -l /dev/tty.*
   ```

3. **Check permissions:**
   ```bash
   # Linux - add your user to dialout group
   sudo usermod -a -G dialout $USER
   # Then log out and back in
   ```

### Connection Timeout

If you get connection timeouts:

1. Make sure obdsim is running before starting your Python script
2. Try specifying the port explicitly in `car.py`
3. Check that the port path is correct

### Permission Denied

If you get permission errors:

```bash
# Linux
sudo chmod 666 /dev/pts/0  # Replace with your port

# Or add your user to the dialout group (see above)
```

## Switching Between Real Hardware and Simulator

To switch between real OBD hardware and obdsim:

1. **For real hardware**: Set `DEFAULT_PORT = None` (or your actual port like `/dev/ttyUSB0`) and ensure obdsim is not running
2. **For simulator**: Start obdsim first, then set `DEFAULT_PORT = None` (for auto-detect) or specify the virtual port explicitly

The `car.py` script will automatically detect whichever is available.

## Example Workflow

1. **Start obdsim:**
   ```bash
   obdsim -g gui_fltk
   ```
   Note the virtual port it creates (e.g., `/dev/pts/0`)

2. **Update car.py** (if needed):
   ```python
   DEFAULT_PORT = "/dev/pts/0"  # Or None for auto-detect
   ```

3. **Run your script:**
   ```bash
   python car.py
   ```

4. **Interact with obdsim GUI** to change simulated values and see your script respond

## Additional Resources

- [obdsim GitHub Repository](https://github.com/icotting/obdsim)
- [python-obd Documentation](https://python-obd.readthedocs.io/)
- [ELM327 Protocol Reference](https://en.wikipedia.org/wiki/ELM327)

