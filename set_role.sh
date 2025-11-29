#!/bin/bash

if [ "$1" = "dev" ]; then
    # Dev role: write to local file, no sudo needed
    # Accept second parameter: car or ground
    if [ -z "$2" ]; then
        echo "Error: 'dev' role requires a second parameter [car|ground]"
        echo "Usage: $0 dev [car|ground]"
        exit 1
    fi
    if [ "$2" != "car" ] && [ "$2" != "ground" ]; then
        echo "Error: Second parameter must be 'car' or 'ground'"
        echo "Usage: $0 dev [car|ground]"
        exit 1
    fi
    echo "dev:$2" > .role
    echo "Role set to 'dev' with app type '$2' (local file)"
elif [ "$1" = "car" ] || [ "$1" = "ground" ]; then
    # Production roles: require sudo, write to /boot/pi_role
    if [ "$EUID" -ne 0 ]; then
        echo "Error: 'car' and 'ground' roles require sudo"
        echo "Usage: sudo $0 [car|ground]"
        exit 1
    fi
    bash -c "echo \"$1\" > /boot/pi_role"
    echo "Role set to '$1' (production)"
else
    echo "Usage: $0 [car|ground|dev [car|ground]]"
    echo "  car|ground: Requires sudo, writes to /boot/pi_role"
    echo "  dev [car|ground]: No sudo needed, writes to local .role file"
    exit 1
fi
