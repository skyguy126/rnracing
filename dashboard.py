import os
import json
import logging
from flask import Flask, request, send_from_directory

# Configure Flask to serve static files from React build
app = Flask(__name__, static_folder='static', static_url_path='')

# Set up logging for journald (level and function info only, journald handles timestamps/metadata)
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s | %(name)s:%(funcName)s | %(message)s'
)

# Get logger for this module
logger = logging.getLogger(__name__)


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


@app.route("/<path:path>")
def serve_static(path):
    """Serve static files from React build directory"""
    # Don't serve API routes as static files
    if path.startswith('api/'):
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
    port = int(os.getenv("PORT", 9999))
    logger.info(f"Starting Flask web server on port {port}...")
    app.run(host="0.0.0.0", port=port, debug=True)


if __name__ == "__main__":
    main()
