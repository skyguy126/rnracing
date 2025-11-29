#!/bin/bash
# Build script for React frontend

set -e

echo "Building React frontend..."

cd frontend

# Check if node_modules exists, if not install dependencies
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Build the frontend
echo "Building for production..."
npm run build

echo "Frontend build complete! Static files are in ../static/"
cd ..
