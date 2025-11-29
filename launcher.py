import pathlib
import sys

ROLE_FILE = pathlib.Path("/boot/pi_role")


def get_role() -> str:
    try:
        role = ROLE_FILE.read_text().strip().lower()
    except FileNotFoundError:
        role = "unknown"
    return role


def main():

    print("sys.executable:", sys.executable)
    print("sys.version:", sys.version)

    role = get_role()
    print(f"[launcher] Detected role: {role!r}")

    if role == "car":
        from car import main as app_main
    elif role == "ground":
        from ground import main as app_main
    else:
        print("[launcher] Unknown role; exiting.")
        sys.exit(1)

    app_main()


if __name__ == "__main__":
    main()
