import pathlib
import sys
from typing import Optional

# Check local dev role first, then production role
LOCAL_ROLE_FILE = pathlib.Path(__file__).parent / ".role"
PROD_ROLE_FILE = pathlib.Path("/boot/pi_role")


def get_role() -> tuple[str, Optional[str]]:
    """
    Returns (role, app_type) tuple.
    role: 'dev', 'car', 'ground', or 'unknown'
    app_type: 'car' or 'ground' for dev role, None otherwise
    """
    # Check for dev role (local file) first
    if LOCAL_ROLE_FILE.exists():
        try:
            content = LOCAL_ROLE_FILE.read_text().strip().lower()
            if content.startswith("dev:"):
                # Parse "dev:car" or "dev:ground"
                parts = content.split(":", 1)
                if len(parts) == 2 and parts[1] in ("car", "ground"):
                    return ("dev", parts[1])
            elif content == "dev":
                # Legacy format without app type, default to ground
                return ("dev", "ground")
        except Exception:
            pass
    
    # Fall back to production role file
    try:
        role = PROD_ROLE_FILE.read_text().strip().lower()
        return (role, None)
    except FileNotFoundError:
        return ("unknown", None)


def main():
    role, app_type = get_role()
    print(f"[launcher] Detected role: {role!r}", end="")
    if app_type:
        print(f" (app type: {app_type!r})")
    else:
        print()

    if role == "car":
        from car import main as app_main
    elif role == "ground":
        from ground import main as app_main
    elif role == "dev":
        # Use app_type to determine which module to import
        if app_type == "car":
            from car import main as app_main
        elif app_type == "ground":
            from ground import main as app_main
        else:
            print("[launcher] Dev role requires app type (car or ground); exiting.")
            sys.exit(1)
    else:
        print("[launcher] Unknown role; exiting.")
        sys.exit(1)

    app_main()


if __name__ == "__main__":
    main()
