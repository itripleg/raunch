"""Live CLI test - run against running server."""

import subprocess
import sys
import time

def test_cli_connect():
    """Test CLI connect command with automated input."""
    # Send commands via stdin
    # Use 'jake' to fuzzy match 'Jake Morrison'
    input_commands = """new
1
c
a jake
w hello there
q
"""

    proc = subprocess.Popen(
        [sys.executable, "-m", "raunch.main", "connect", "localhost", "--port", "8000"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    try:
        stdout, stderr = proc.communicate(input=input_commands, timeout=30)
        print("STDOUT:")
        print(stdout)
        print("\nSTDERR:")
        print(stderr)

        # Check for success indicators
        assert "Connected" in stdout or "Connecting" in stdout, "Should show connection"
        assert "Librarian ID" in stdout, "Should show librarian ID"
        assert "Joined as reader" in stdout, "Should join as reader"
        # Check fuzzy attach worked
        if "Attached to Jake" in stdout:
            print("Fuzzy attach worked!")
        print("\n[PASS] CLI connect test passed!")
        return True
    except subprocess.TimeoutExpired:
        proc.kill()
        print("❌ CLI test timed out")
        return False
    except AssertionError as e:
        print(f"❌ CLI test failed: {e}")
        return False


if __name__ == "__main__":
    success = test_cli_connect()
    sys.exit(0 if success else 1)
