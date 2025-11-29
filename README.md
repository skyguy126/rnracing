# rnracing

Racing telemetry system for car and ground station nodes.

## Setup

### OBD-II Integration

This project uses [python-obd](https://github.com/brendan-w/python-OBD) for reading OBD-II data from your car's diagnostic port.

For development and testing without physical access to a car, you can use `obdsim` to simulate OBD data. See [OBD_SIM.md](OBD_SIM.md) for detailed setup and usage instructions.

**Quick Start with obdsim:**

1. Install obdsim (see [OBD_SIM.md](OBD_SIM.md) for installation instructions)
2. Start the simulator:
   ```bash
   ./start_obdsim.sh
   ```
   Or manually:
   ```bash
   obdsim -g gui_fltk
   ```
3. Run the car node:
   ```bash
   python car.py
   ```

### Python Dependencies

Install dependencies:
```bash
pip install -r requirements.txt
```

### Running the Application

Use the launcher script:
```bash
python launcher.py
```

Or run components directly:
```bash
python car.py      # Car node
python ground.py   # Ground station node
```
