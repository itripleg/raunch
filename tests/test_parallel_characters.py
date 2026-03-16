"""Integration tests for parallel character processing in the orchestrator."""

import time
from unittest.mock import patch, MagicMock, Mock

try:
    import pytest
except ImportError:
    pytest = None

from raunch.orchestrator import Orchestrator
from raunch.agents import Character


class TestParallelCharacterProcessing:
    """Tests for parallel character LLM calls using ThreadPoolExecutor."""

    def test_multiple_characters_process_in_parallel(self):
        """
        Test that multiple characters are processed and all results are present.

        Verification steps:
        1. Create orchestrator with 3 characters
        2. Mock LLM responses for narrator and characters
        3. Run a page
        4. Verify all 3 characters have results in output
        """
        orch = Orchestrator()

        # Add 3 test characters
        char1 = Character(name="Alice", species="Human", personality="Curious")
        char2 = Character(name="Bob", species="Robot", personality="Logical")
        char3 = Character(name="Charlie", species="Alien", personality="Mysterious")

        orch.add_character(char1, location="Station Hub")
        orch.add_character(char2, location="Station Hub")
        orch.add_character(char3, location="Station Hub")

        # Mock narrator response
        narrator_response = {
            "narration": "The station hums with activity.",
            "events": ["power_surge"],
            "world_time": "Day 1, Morning",
            "mood": "tense"
        }

        # Mock character responses
        char_responses = {
            "Alice": {"inner_thoughts": "I wonder what's happening.", "action": "Look around", "emotional_state": "curious"},
            "Bob": {"inner_thoughts": "Analyzing the situation.", "action": "Scan surroundings", "emotional_state": "calm"},
            "Charlie": {"inner_thoughts": "This is familiar.", "action": "Stay alert", "emotional_state": "watchful"}
        }

        # Patch the agent base class's page method
        with patch.object(Character, 'page') as mock_char_page, \
             patch('raunch.orchestrator.Narrator') as mock_narrator_class:

            # Setup narrator mock
            mock_narrator = MagicMock()
            mock_narrator.page.return_value = narrator_response
            mock_narrator_class.return_value = mock_narrator
            orch.narrator = mock_narrator

            # Setup character page mock to return different responses based on character
            def char_page_side_effect(world_context):
                # Extract character name from the mock's parent
                for name, char in orch.characters.items():
                    if char.page == mock_char_page:
                        return char_responses[name]
                # Fallback: return response based on call order
                return char_responses[list(char_responses.keys())[mock_char_page.call_count - 1]]

            mock_char_page.side_effect = char_page_side_effect

            # Run a page
            results = orch._run_page()

            # Verify all characters have results
            assert results["page"] == 1
            assert "narration" in results
            assert results["narration"] == "The station hums with activity."
            assert "characters" in results
            assert len(results["characters"]) == 3

            # Verify each character's result is present
            assert "Alice" in results["characters"]
            assert "Bob" in results["characters"]
            assert "Charlie" in results["characters"]

            # Verify character results contain expected data
            assert results["characters"]["Alice"]["inner_thoughts"] == "I wonder what's happening."
            assert results["characters"]["Bob"]["action"] == "Scan surroundings"
            assert results["characters"]["Charlie"]["emotional_state"] == "watchful"

    def test_parallel_execution_timing(self):
        """
        Test that parallel execution is faster than sequential execution.

        With 3 characters, if each takes 0.1s, parallel should take ~0.1s, not 0.3s.
        """
        orch = Orchestrator()

        # Add 3 test characters
        for i in range(3):
            char = Character(name=f"Char{i}", species="Human")
            orch.add_character(char, location="Test")

        # Mock narrator to be fast
        with patch('raunch.orchestrator.Narrator') as mock_narrator_class, \
             patch.object(Character, 'page') as mock_char_page:

            mock_narrator = MagicMock()
            mock_narrator.page.return_value = {
                "narration": "Test narration",
                "events": [],
                "world_time": "Now",
                "mood": "neutral"
            }
            mock_narrator_class.return_value = mock_narrator
            orch.narrator = mock_narrator

            # Each character page takes 0.1 seconds
            def slow_page(world_context):
                time.sleep(0.1)
                return {
                    "inner_thoughts": "Thinking...",
                    "action": "Acting...",
                    "emotional_state": "neutral"
                }

            mock_char_page.side_effect = slow_page

            # Measure execution time
            start = time.time()
            results = orch._run_page()
            elapsed = time.time() - start

            # With parallel execution, should take ~0.1s (plus overhead)
            # With sequential, would take ~0.3s
            # Allow for some overhead, but should be much less than 0.25s
            assert elapsed < 0.25, f"Parallel execution too slow: {elapsed:.3f}s (expected < 0.25s)"
            assert len(results["characters"]) == 3

    def test_single_character_no_error(self):
        """Test that single character works correctly (edge case)."""
        orch = Orchestrator()

        char = Character(name="Solo", species="Human")
        orch.add_character(char, location="Alone")

        with patch('raunch.orchestrator.Narrator') as mock_narrator_class, \
             patch.object(Character, 'page') as mock_char_page:

            mock_narrator = MagicMock()
            mock_narrator.page.return_value = {
                "narration": "Silence.",
                "events": [],
                "world_time": "Now",
                "mood": "quiet"
            }
            mock_narrator_class.return_value = mock_narrator
            orch.narrator = mock_narrator

            mock_char_page.return_value = {
                "inner_thoughts": "Alone with my thoughts.",
                "action": "Reflect",
                "emotional_state": "contemplative"
            }

            results = orch._run_page()

            assert len(results["characters"]) == 1
            assert "Solo" in results["characters"]
            assert results["characters"]["Solo"]["inner_thoughts"] == "Alone with my thoughts."

    def test_zero_characters_no_crash(self):
        """Test that running with 0 characters doesn't crash (edge case)."""
        orch = Orchestrator()

        with patch('raunch.orchestrator.Narrator') as mock_narrator_class:
            mock_narrator = MagicMock()
            mock_narrator.page.return_value = {
                "narration": "Empty world.",
                "events": [],
                "world_time": "Now",
                "mood": "empty"
            }
            mock_narrator_class.return_value = mock_narrator
            orch.narrator = mock_narrator

            results = orch._run_page()

            assert results["page"] == 1
            assert "narration" in results
            assert len(results["characters"]) == 0

    def test_character_with_influence(self):
        """Test that character processing works with influence whispered."""
        orch = Orchestrator()

        char = Character(name="Influenced", species="Human")
        orch.add_character(char, location="Test")

        # Submit influence before page
        orch.submit_influence("Influenced", "You feel compelled to explore.")

        with patch('raunch.orchestrator.Narrator') as mock_narrator_class, \
             patch.object(Character, 'page') as mock_char_page:

            mock_narrator = MagicMock()
            mock_narrator.page.return_value = {
                "narration": "Test.",
                "events": [],
                "world_time": "Now",
                "mood": "neutral"
            }
            mock_narrator_class.return_value = mock_narrator
            orch.narrator = mock_narrator

            # Track what input the character received
            received_input = []

            def capture_input(world_context):
                received_input.append(world_context)
                return {
                    "inner_thoughts": "I feel compelled...",
                    "action": "Explore",
                    "emotional_state": "curious"
                }

            mock_char_page.side_effect = capture_input

            results = orch._run_page()

            # Verify character was called
            assert len(results["characters"]) == 1
            assert "Influenced" in results["characters"]

            # Verify influence was in the input
            assert len(received_input) == 1
            assert "INNER VOICE" in received_input[0]
            assert "You feel compelled to explore" in received_input[0]

    def test_one_character_fails_others_succeed(self):
        """Test error handling: one character fails but others continue."""
        orch = Orchestrator()

        char1 = Character(name="Good1", species="Human")
        char2 = Character(name="Faulty", species="Human")
        char3 = Character(name="Good2", species="Human")

        orch.add_character(char1, location="Test")
        orch.add_character(char2, location="Test")
        orch.add_character(char3, location="Test")

        with patch('raunch.orchestrator.Narrator') as mock_narrator_class, \
             patch.object(Character, 'page') as mock_char_page:

            mock_narrator = MagicMock()
            mock_narrator.page.return_value = {
                "narration": "Test narration",
                "events": [],
                "world_time": "Now",
                "mood": "neutral"
            }
            mock_narrator_class.return_value = mock_narrator
            orch.narrator = mock_narrator

            # Track which character is being called
            call_count = [0]

            def char_page_with_error(world_context):
                call_count[0] += 1
                # Second call (Faulty character) raises an error
                if call_count[0] == 2:
                    raise Exception("LLM API Error")
                return {
                    "inner_thoughts": f"Thoughts {call_count[0]}",
                    "action": f"Action {call_count[0]}",
                    "emotional_state": "neutral"
                }

            mock_char_page.side_effect = char_page_with_error

            results = orch._run_page()

            # All 3 characters should have results
            assert len(results["characters"]) == 3

            # The faulty character should have error result
            has_error = False
            for name, result in results["characters"].items():
                if "[Error:" in result.get("inner_thoughts", ""):
                    has_error = True
                    assert result["action"] is None

            assert has_error, "Expected one character to have error result"

            # At least 2 characters should have succeeded
            success_count = sum(
                1 for result in results["characters"].values()
                if "[Error:" not in result.get("inner_thoughts", "")
            )
            assert success_count >= 2

    def test_streaming_callback_thread_safety(self):
        """Test that streaming callbacks are properly synchronized."""
        orch = Orchestrator()

        char1 = Character(name="Stream1", species="Human")
        char2 = Character(name="Stream2", species="Human")

        orch.add_character(char1, location="Test")
        orch.add_character(char2, location="Test")

        # Track streaming callbacks
        callback_calls = []

        def stream_callback(page_num, char_name, event_type, content):
            callback_calls.append({
                "page": page_num,
                "character": char_name,
                "type": event_type,
                "content": content
            })

        orch.set_stream_callback(stream_callback)

        with patch('raunch.orchestrator.Narrator') as mock_narrator_class, \
             patch.object(Character, 'page_stream') as mock_char_page_stream:

            mock_narrator = MagicMock()
            mock_narrator.page_stream.return_value = {
                "narration": "Test",
                "events": [],
                "world_time": "Now",
                "mood": "neutral"
            }
            mock_narrator_class.return_value = mock_narrator
            orch.narrator = mock_narrator

            # Simulate streaming with delays
            def stream_page(world_context, on_delta=None):
                time.sleep(0.05)
                if on_delta:
                    on_delta("chunk1")
                    time.sleep(0.05)
                    on_delta("chunk2")
                return {
                    "inner_thoughts": "Streaming thoughts",
                    "action": "Streaming action",
                    "emotional_state": "neutral"
                }

            mock_char_page_stream.side_effect = stream_page

            results = orch._run_page()

            # Verify both characters processed
            assert len(results["characters"]) == 2

            # Verify streaming callbacks were made
            # Should have: narrator start, narrator done, char1 deltas, char1 done, char2 deltas, char2 done
            assert len(callback_calls) > 0

            # Check that we got callbacks for both characters
            char_callbacks = [c for c in callback_calls if c["character"] in ["Stream1", "Stream2"]]
            assert len(char_callbacks) > 0

    def test_player_waiting_for_input_skipped(self):
        """Test that player character is skipped when waiting for input."""
        orch = Orchestrator()

        char1 = Character(name="NPC", species="Human")
        char2 = Character(name="Player", species="Human")

        orch.add_character(char1, location="Test")
        orch.add_character(char2, location="Test")
        orch.set_player("Player")

        # Don't provide player input - should skip player character

        with patch('raunch.orchestrator.Narrator') as mock_narrator_class, \
             patch.object(Character, 'page') as mock_char_page:

            mock_narrator = MagicMock()
            mock_narrator.page.return_value = {
                "narration": "Test",
                "events": [],
                "world_time": "Now",
                "mood": "neutral"
            }
            mock_narrator_class.return_value = mock_narrator
            orch.narrator = mock_narrator

            mock_char_page.return_value = {
                "inner_thoughts": "NPC thoughts",
                "action": "NPC action",
                "emotional_state": "neutral"
            }

            results = orch._run_page()

            # Both characters should have results
            assert len(results["characters"]) == 2
            assert "NPC" in results["characters"]
            assert "Player" in results["characters"]

            # Player should be waiting
            assert results["characters"]["Player"]["inner_thoughts"] == "[Awaiting player input...]"
            assert results["characters"]["Player"]["action"] is None
            assert results["characters"]["Player"].get("waiting_for_player") is True

            # NPC should have normal result
            assert results["characters"]["NPC"]["inner_thoughts"] == "NPC thoughts"


# Run tests if pytest not available
if __name__ == "__main__":
    if pytest is None:
        print("pytest not available, running tests manually...")
        test_class = TestParallelCharacterProcessing()

        tests = [
            ("test_multiple_characters_process_in_parallel", test_class.test_multiple_characters_process_in_parallel),
            ("test_parallel_execution_timing", test_class.test_parallel_execution_timing),
            ("test_single_character_no_error", test_class.test_single_character_no_error),
            ("test_zero_characters_no_crash", test_class.test_zero_characters_no_crash),
            ("test_character_with_influence", test_class.test_character_with_influence),
            ("test_one_character_fails_others_succeed", test_class.test_one_character_fails_others_succeed),
            ("test_streaming_callback_thread_safety", test_class.test_streaming_callback_thread_safety),
            ("test_player_waiting_for_input_skipped", test_class.test_player_waiting_for_input_skipped),
        ]

        passed = 0
        failed = 0

        for name, test_func in tests:
            try:
                print(f"Running {name}...", end=" ")
                test_func()
                print("PASSED")
                passed += 1
            except Exception as e:
                print(f"FAILED: {e}")
                failed += 1

        print(f"\n{passed} passed, {failed} failed")
        exit(0 if failed == 0 else 1)
    else:
        pytest.main([__file__, "-v"])
