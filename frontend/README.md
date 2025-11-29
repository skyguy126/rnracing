# RN Racing Frontend

React frontend application built with Vite for the RN Racing Ground Station.

## Development

To run the frontend in development mode:

```bash
cd frontend
npm install  # First time only
npm run dev
```

This will start the Vite dev server on `http://localhost:3000` with hot module replacement.

## Building for Production

To build the frontend for production (required before Flask can serve it):

```bash
# From project root
./build_frontend.sh
```

Or manually:

```bash
cd frontend
npm install
npm run build
```

The built files will be output to `../static/` directory, which Flask serves.

## Production Setup

After building, Flask will automatically serve the frontend from the root path (`/`). The frontend will be available when you start the Flask server:

```bash
python ground.py
```

Then visit `http://localhost:5000` (or whatever port Flask is configured to use).

