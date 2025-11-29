import os
import json
import logging
import queue
import threading
from flask import Flask, request, send_from_directory, Response, stream_with_context

# Configure Flask to serve static files from React build
app = Flask(__name__, static_folder='static', static_url_path='')

# Set up logging for journald (level and function info only, journald handles timestamps/metadata)
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s | %(name)s:%(funcName)s | %(message)s'
)

# Get logger for this module
logger = logging.getLogger(__name__)

# Thread-safe queue to store SSE client queues
sse_clients = []
sse_lock = threading.Lock()


def broadcast_data(data):
    """Broadcast data to all connected SSE clients"""
    data_json = json.dumps(data)
    message = f"data: {data_json}\n\n"
    
    with sse_lock:
        # Remove disconnected clients
        disconnected_clients = []
        for i, client_queue in enumerate(sse_clients):
            try:
                client_queue.put_nowait(message)
            except queue.Full:
                disconnected_clients.append(i)
            except Exception as e:
                logger.warning(f"Error sending to SSE client: {e}")
                disconnected_clients.append(i)
        
        # Remove disconnected clients (iterate in reverse to maintain indices)
        for i in reversed(disconnected_clients):
            sse_clients.pop(i)
    
    logger.info(f"Broadcasted data to {len(sse_clients)} SSE client(s)")


@app.route("/events")
def stream_events():
    """Server-Sent Events endpoint for real-time data streaming"""
    def event_stream():
        # Create a queue for this client
        client_queue = queue.Queue(maxsize=100)
        
        # Add client to the list
        with sse_lock:
            sse_clients.append(client_queue)
        
        logger.info(f"SSE client connected. Total clients: {len(sse_clients)}")
        
        try:
            # Send initial connection message
            yield f"data: {json.dumps({'type': 'connected', 'message': 'SSE connection established'})}\n\n"
            
            # Keep connection alive and send messages
            while True:
                try:
                    # Wait for a message (with timeout for keep-alive)
                    message = client_queue.get(timeout=30)
                    yield message
                except queue.Empty:
                    # Send keep-alive comment
                    yield ": keep-alive\n\n"
        except GeneratorExit:
            logger.info("SSE client disconnected")
        finally:
            # Remove client from the list
            with sse_lock:
                if client_queue in sse_clients:
                    sse_clients.remove(client_queue)
            logger.info(f"SSE client removed. Total clients: {len(sse_clients)}")
    
    return Response(
        stream_with_context(event_stream()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive'
        }
    )


@app.route("/data", methods=["POST"])
def receive_data():
    try:
        data = request.get_json()
        if data is None:
            logger.warning(
                "Received POST request with no JSON data",
                extra={"client_ip": request.remote_addr, "content_type": request.content_type}
            )
            return {"error": "No JSON data provided"}, 400
        
        logger.info(
            f"Received data: {json.dumps(data, indent=2)}",
            extra={"client_ip": request.remote_addr, "data_size": len(json.dumps(data))}
        )
        
        # Broadcast data to all connected SSE clients
        broadcast_data(data)
        
        return {"status": "success", "message": "Data received"}, 200
    except json.JSONDecodeError as e:
        logger.error(
            f"JSON decode error: {str(e)}",
            extra={"client_ip": request.remote_addr, "error_type": "JSONDecodeError"},
            exc_info=True
        )
        return {"error": "Invalid JSON format"}, 400
    except Exception as e:
        logger.error(
            f"Error processing data: {str(e)}",
            extra={"client_ip": request.remote_addr, "error_type": type(e).__name__},
            exc_info=True
        )
        return {"error": "Internal server error"}, 500


@app.route("/")
def serve_frontend():
    """Serve the React frontend index.html"""
    if not os.path.exists(os.path.join(app.static_folder, 'index.html')):
        return {
            "error": "Frontend not built",
            "message": "Please run './build_frontend.sh' to build the React frontend"
        }, 503
    return send_from_directory(app.static_folder, 'index.html')


@app.route("/tiles/<int:z>/<int:x>/<int:y>.png")
def serve_tile(z, x, y):
    """Serve map tiles from sonoma_raceway_tiles directory"""
    tile_path = os.path.join('sonoma_raceway_tiles', str(z), str(x), f'{y}.png')
    
    if os.path.exists(tile_path) and os.path.isfile(tile_path):
        return send_from_directory('sonoma_raceway_tiles', f'{z}/{x}/{y}.png', mimetype='image/png')
    else:
        logger.debug(f"Tile not found: {tile_path}")
        return {"error": "Tile not found"}, 404


@app.route("/<path:path>")
def serve_static(path):
    """Serve static files from React build directory"""
    # Don't serve API routes as static files
    if path.startswith('api/'):
        return {"error": "Not found"}, 404
    
    # Don't serve tiles through this route (handled by serve_tile)
    if path.startswith('tiles/'):
        return {"error": "Not found"}, 404
    
    # Try to serve the file, fallback to index.html for client-side routing
    file_path = os.path.join(app.static_folder, path)
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return send_from_directory(app.static_folder, path)
    else:
        # Fallback to index.html for client-side routing
        if os.path.exists(os.path.join(app.static_folder, 'index.html')):
            return send_from_directory(app.static_folder, 'index.html')
        return {"error": "Frontend not built"}, 503


def main():
    logger.info("Starting GROUND STATION logic...")
    port = int(os.getenv("PORT", 5000))
    logger.info(f"Starting Flask web server on port {port}...")
    app.run(host="0.0.0.0", port=port, debug=True)


if __name__ == "__main__":
    main()
