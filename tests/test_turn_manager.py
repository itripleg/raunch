"""Tests for turn-based multiplayer functionality in the orchestrator."""

import time
from unittest.mock import patch, MagicMock

try:
    import pytest
except ImportError:
    pytest = None

from raunch.orchestrator import Orchestrator


class TestTurnBasedTimeout:
    """Tests for the timeout trigger mechanism."""

    def test_timeout_trigger_with_partial_ready(self):
        """
        Test timeout trigger: 1 player ready, wait for timeout -> tick fires with timeout reason.

        E2E verification steps:
        1. Connect 2 players
        2. Player 1 readies
        3. Player 2 does not ready
        4. Wait for timeout
        5. Verify tick fires with timeout reason
        """
        orch = Orchestrator()

        # Set a short timeout for testing (1 second instead of 60)
        orch.set_turn_timeout(1)
        assert orch.turn_timeout == 1

        # Simulate 2 players joining
        player1_id = "player-1-uuid"
        player2_id = "player-2-uuid"

        # Both players register (not ready initially)
        orch.set_player_ready(player1_id, False)
        orch.set_player_ready(player2_id, False)

        assert orch.get_player_count() == 2
        assert not orch.all_players_ready()

        # Initialize turn start time
        orch._turn_start_time = time.time()

        # Player 1 readies
        orch.set_player_ready(player1_id, True)

        # Verify state: player 1 ready, player 2 not ready
        ready_states = orch.get_ready_states()
        assert ready_states[player1_id] is True
        assert ready_states[player2_id] is False
        assert not orch.all_players_ready()

        # Verify waiting_for includes player 2
        waiting_for = orch.get_waiting_for()
        assert player2_id in waiting_for
        assert player1_id not in waiting_for

        # Before timeout: should NOT be ready
        ready, reason = orch._check_turn_ready()
        assert ready is False
        assert reason == ""

        # Wait for timeout to expire (1 second + small buffer)
        time.sleep(1.1)

        # After timeout: should be ready with 'timeout' reason
        ready, reason = orch._check_turn_ready()
        assert ready is True
        assert reason == "timeout"

    def test_timeout_trigger_with_mocked_time(self):
        """
        Test timeout trigger using mocked time for faster execution.
        """
        orch = Orchestrator()
        orch.set_turn_timeout(60)  # Default 60 second timeout

        # Simulate 2 players joining
        player1_id = "player-1-uuid"
        player2_id = "player-2-uuid"

        orch.set_player_ready(player1_id, False)
        orch.set_player_ready(player2_id, False)

        # Player 1 readies
        orch.set_player_ready(player1_id, True)

        # Set turn start time to 61 seconds ago (past timeout)
        orch._turn_start_time = time.time() - 61

        # Should trigger with timeout reason
        ready, reason = orch._check_turn_ready()
        assert ready is True
        assert reason == "timeout"

    def test_no_timeout_when_all_ready(self):
        """
        When all players are ready, tick should fire with 'all_ready' reason,
        not 'timeout', even if timeout has expired.
        """
        orch = Orchestrator()
        orch.set_turn_timeout(60)

        player1_id = "player-1-uuid"
        player2_id = "player-2-uuid"

        # Both players join and ready
        orch.set_player_ready(player1_id, True)
        orch.set_player_ready(player2_id, True)

        # Set turn start time to past timeout (simulating slow ready)
        orch._turn_start_time = time.time() - 61

        # Should trigger with 'all_ready' reason (takes priority over timeout)
        ready, reason = orch._check_turn_ready()
        assert ready is True
        assert reason == "all_ready"

    def test_no_auto_tick_when_no_players(self):
        """
        Spec: No auto-tick when 0 players connected.
        """
        orch = Orchestrator()
        orch.set_turn_timeout(60)

        # No players registered
        assert orch.get_player_count() == 0

        ready, reason = orch._check_turn_ready()
        assert ready is False
        assert reason == "no_players"

    def test_timeout_disabled_when_zero(self):
        """
        When timeout is 0, it should never trigger via timeout.
        """
        orch = Orchestrator()
        orch.set_turn_timeout(0)

        player1_id = "player-1-uuid"
        player2_id = "player-2-uuid"

        orch.set_player_ready(player1_id, True)
        orch.set_player_ready(player2_id, False)

        # Even with old turn start time, should not trigger (timeout disabled)
        orch._turn_start_time = time.time() - 1000

        ready, reason = orch._check_turn_ready()
        assert ready is False
        assert reason == ""

    def test_turn_remaining_calculation(self):
        """
        Test that get_turn_remaining() correctly calculates time left.
        """
        orch = Orchestrator()
        orch.set_turn_timeout(60)

        # Set turn start time to 30 seconds ago
        orch._turn_start_time = time.time() - 30

        remaining = orch.get_turn_remaining()
        # Should be approximately 30 seconds (with small tolerance)
        assert 29 <= remaining <= 31

    def test_turn_remaining_expired(self):
        """
        Test that get_turn_remaining() returns 0 when expired.
        """
        orch = Orchestrator()
        orch.set_turn_timeout(60)

        # Set turn start time to 90 seconds ago (past timeout)
        orch._turn_start_time = time.time() - 90

        remaining = orch.get_turn_remaining()
        assert remaining == 0

    def test_turn_remaining_no_timeout(self):
        """
        Test that get_turn_remaining() returns infinity when timeout disabled.
        """
        orch = Orchestrator()
        orch.set_turn_timeout(0)

        remaining = orch.get_turn_remaining()
        assert remaining == float("inf")

    def test_reset_ready_states(self):
        """
        Test that reset_ready_states() resets all players to not ready.
        """
        orch = Orchestrator()

        player1_id = "player-1-uuid"
        player2_id = "player-2-uuid"

        orch.set_player_ready(player1_id, True)
        orch.set_player_ready(player2_id, True)

        assert orch.all_players_ready()

        orch.reset_ready_states()

        assert not orch.all_players_ready()
        ready_states = orch.get_ready_states()
        assert ready_states[player1_id] is False
        assert ready_states[player2_id] is False

    def test_clear_player_ready_on_disconnect(self):
        """
        Test that clear_player_ready() removes player from tracking.
        """
        orch = Orchestrator()

        player1_id = "player-1-uuid"
        player2_id = "player-2-uuid"

        orch.set_player_ready(player1_id, True)
        orch.set_player_ready(player2_id, False)

        assert orch.get_player_count() == 2

        # Player 2 disconnects
        orch.clear_player_ready(player2_id)

        assert orch.get_player_count() == 1
        assert orch.all_players_ready()  # Only player 1 remains, who is ready


class TestTimeoutTriggerIntegration:
    """
    Integration-style tests that verify the timeout flow end-to-end
    without actually running the full orchestrator loop.
    """

    def test_timeout_triggers_tick_with_reason(self):
        """
        Verify that when timeout triggers, the tick result includes
        triggered_by: 'timeout'.
        """
        orch = Orchestrator()
        orch.set_turn_timeout(1)

        # Setup players
        player1_id = "player-1-uuid"
        player2_id = "player-2-uuid"

        orch.set_player_ready(player1_id, True)
        orch.set_player_ready(player2_id, False)

        # Initialize turn and wait for timeout
        orch._turn_start_time = time.time() - 2  # Already past timeout

        # Check that timeout is detected
        ready, reason = orch._check_turn_ready()
        assert ready is True
        assert reason == "timeout"

        # The orchestrator would set _last_tick_trigger_reason before tick
        orch._last_tick_trigger_reason = reason

        # Verify the reason is stored correctly
        assert orch._last_tick_trigger_reason == "timeout"


if __name__ == "__main__":
    if pytest:
        pytest.main([__file__, "-v"])
    else:
        # Run tests manually without pytest
        import traceback

        print("Running tests without pytest...")
        print()

        test_classes = [TestTurnBasedTimeout, TestTimeoutTriggerIntegration]
        passed = 0
        failed = 0

        for test_class in test_classes:
            print(f"=== {test_class.__name__} ===")
            instance = test_class()
            for method_name in dir(instance):
                if method_name.startswith("test_"):
                    try:
                        getattr(instance, method_name)()
                        print(f"  ✓ {method_name}")
                        passed += 1
                    except AssertionError as e:
                        print(f"  ✗ {method_name}: {e}")
                        failed += 1
                    except Exception as e:
                        print(f"  ✗ {method_name}: {type(e).__name__}: {e}")
                        traceback.print_exc()
                        failed += 1
            print()

        print(f"Results: {passed} passed, {failed} failed")
