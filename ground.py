import os
from flask import Flask

app = Flask(__name__)


@app.route("/")
def hello_world():
    return "hello world"


def main():
    print("Starting GROUND STATION logic...")
    port = int(os.getenv("PORT", 500))
    print(f"Starting Flask web server on port {port}...")
    app.run(host="0.0.0.0", port=port, debug=True)


if __name__ == "__main__":
    main()
