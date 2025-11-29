import os
import json
import logging
from logging.handlers import RotatingFileHandler
from flask import Flask, request

app = Flask(__name__)

# Set up logging with best practices
log_file = "ground_station.log"

# Create formatter with ISO 8601 timestamp, process/thread info, and function/line details
formatter = logging.Formatter(
    fmt='%(asctime)s.%(msecs)03dZ | %(levelname)-8s | [%(process)d:%(thread)d] | %(name)s:%(funcName)s:%(lineno)d | %(message)s',
    datefmt='%Y-%m-%dT%H:%M:%S'
)

# File handler with rotation to prevent log files from growing too large
file_handler = RotatingFileHandler(
    log_file,
    mode='a',
    maxBytes=10*1024*1024,  # 10MB
    backupCount=5,
    encoding='utf-8'
)
file_handler.setLevel(logging.INFO)
file_handler.setFormatter(formatter)

# Console handler
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(formatter)

# Configure root logger
root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)
root_logger.addHandler(file_handler)
root_logger.addHandler(console_handler)

# Get logger for this module
logger = logging.getLogger(__name__)


@app.route("/")
def hello_world():
    return "hello world"


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


def main():
    logger.info("Starting GROUND STATION logic...")
    port = int(os.getenv("PORT", 500))
    logger.info(f"Starting Flask web server on port {port}...")
    app.run(host="0.0.0.0", port=port, debug=True)


if __name__ == "__main__":
    main()
