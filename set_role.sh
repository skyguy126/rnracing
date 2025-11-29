#!/bin/bash

# Check if running as root (sudo)
if [ "$EUID" -ne 0 ]; then
    echo "Error: This script must be run with sudo"
    echo "Usage: sudo $0 [car|ground]"
    exit 1
fi

if [ "$1" = "car" ]; then
    bash -c 'echo "car" > /boot/pi_role'
elif [ "$1" = "ground" ]; then
    bash -c 'echo "ground" > /boot/pi_role'
else
    echo "Usage: $0 [car|ground]"
    exit 1
fi