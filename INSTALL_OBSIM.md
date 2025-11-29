# Installing obdsim on macOS (M1/M2/M3)

This guide explains how to build and install `obdsim` from source on macOS, specifically for Apple Silicon (M1/M2/M3) Macs.

## Prerequisites

- macOS with Apple Silicon (M1/M2/M3) or Intel
- Xcode Command Line Tools (install with `xcode-select --install`)
- CMake (version 3.10 or higher)
- Git (optional, for downloading)

## Installation Steps

### 1. Download obdgpslogger Source

Download the source archive from the official website:

```bash
curl -O https://icculus.org/obdgpslogger/downloads/obdgpslogger-0.16.tar.gz
```

### 2. Extract the Archive

```bash
tar -xzf obdgpslogger-0.16.tar.gz
cd obdgpslogger-0.16
```

### 3. Fix CMake Compatibility Issues

The original CMakeLists.txt requires CMake 2.6, which is incompatible with modern CMake versions. Apply these fixes:

**Edit `CMakeLists.txt`:**

1. Change line 1 from:
   ```cmake
   CMAKE_MINIMUM_REQUIRED(VERSION 2.6)
   ```
   to:
   ```cmake
   CMAKE_MINIMUM_REQUIRED(VERSION 3.10)
   ```

2. Remove or comment out lines 3-8 (the deprecated CMAKE_POLICY settings):
   ```cmake
   # Note: Removed deprecated CMake policies CMP0005 and CMP0003
   # Modern CMake requires NEW behavior for these policies
   ```

### 4. Configure the Build

Create a build directory and configure with CMake:

```bash
mkdir build
cd build
cmake .. -DOBD_DISABLE_GUI=ON
```

**Note:** We disable the GUI (`-DOBD_DISABLE_GUI=ON`) because it requires FLTK, which isn't necessary for obdsim. The headless version works perfectly for OBD simulation.

### 5. Build obdsim

Build only the obdsim executable:

```bash
make obdsim
```

This will compile obdsim and place it in `../bin/obdsim`.

### 6. Install obdsim (Optional)

Make obdsim available system-wide by creating a symlink:

```bash
sudo ln -sf $(pwd)/../bin/obdsim /usr/local/bin/obdsim
```

Or add the bin directory to your PATH by adding this to your `~/.zshrc` or `~/.bash_profile`:

```bash
export PATH="$PATH:/path/to/obdgpslogger-0.16/bin"
```

### 7. Verify Installation

Test that obdsim is working:

```bash
obdsim --version
obdsim --help
```

You should see version information and usage instructions.

## Quick Start

Once installed, you can use obdsim to simulate OBD-II data:

```bash
# Start obdsim with cycle generator (simulates driving cycles)
obdsim -g cycle

# Start with random data generator
obdsim -g random

# Start headless (no output, just creates virtual port)
obdsim -g gui_none

# List all available generators
obdsim -l
```

## Troubleshooting

### CMake Version Error

If you get an error about CMake version compatibility:
- Make sure you've updated `CMakeLists.txt` as described in step 3
- Verify your CMake version: `cmake --version` (should be 3.10+)

### Build Errors

If you encounter build errors:
- Make sure Xcode Command Line Tools are installed: `xcode-select --install`
- Try cleaning the build directory: `rm -rf build && mkdir build`

### Permission Errors

If you get permission errors when creating the symlink:
- Use `sudo` for the symlink command
- Or install to a user-writable location like `~/bin` and add it to your PATH

### FLTK/GUI Errors

If you want the GUI version:
- Install FLTK: `brew install fltk`
- Remove `-DOBD_DISABLE_GUI=ON` from the cmake command
- Note: GUI is optional and not required for basic OBD simulation

## Using obdsim with Python

Once obdsim is running, you can connect to it using python-obd:

```python
import obd

# obdsim creates a virtual serial port (check /dev/ttys* on macOS)
connection = obd.OBD("/dev/ttys000")  # Replace with actual port

# Query OBD data
speed = connection.query(obd.commands.SPEED)
print(speed.value)
```

See `OBD_SIM.md` for more details on using obdsim with your Python scripts.

## References

- [obdgpslogger Official Website](https://icculus.org/obdgpslogger/)
- [obdsim Documentation](https://icculus.org/obdgpslogger/doc/)
- [CMake Documentation](https://cmake.org/documentation/)

