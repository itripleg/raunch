"""Firestore database backend for persistent world history."""

import json
import random
import string
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from .agents.base import _is_refusal
from .config import GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_PROJECT_ID
from .db_sqlite import _extract_character_fields

# ---------------------------------------------------------------------------
# Module-level Firebase initialisation
# ---------------------------------------------------------------------------
_cred = credentials.Certificate(GOOGLE_APPLICATION_CREDENTIALS)
_app = firebase_admin.initialize_app(_cred, {"projectId": FIREBASE_PROJECT_ID})
_db = firestore.client()


def _now_iso() -> str:
    """Return the current UTC time as an ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


# ---- helpers for subcollection batch-delete --------------------------------

def _delete_collection(coll_ref, batch_size: int = 200) -> None:
    """Delete all documents in a collection/subcollection reference."""
    while True:
        docs = list(coll_ref.limit(batch_size).stream())
        if not docs:
            break
        batch = _db.batch()
        for doc in docs:
            batch.delete(doc.reference)
        batch.commit()


# ===========================================================================
# Init
# ===========================================================================

def init_db() -> None:
    """Verify Firestore connectivity (collections are created on first write)."""
    # A lightweight read to confirm we can talk to Firestore
    _db.collection("pages").limit(1).get()


# ===========================================================================
# Page Functions
# ===========================================================================

def save_page(world_id: str, page_num: int, narration: str, events: List[str],
              world_time: str, mood: str, raw_narrator: str = "") -> None:
    """Record a narrator page."""
    _db.collection("pages").add({
        "world_id": world_id,
        "page_num": page_num,
        "narration": narration,
        "events": events,  # native list
        "world_time": world_time,
        "mood": mood,
        "raw_narrator": raw_narrator,
        "created_at": _now_iso(),
    })
    # Update the book's page_count
    book_ref = _db.collection("books").document(world_id)
    book_ref.update({
        "page_count": page_num,
        "last_active": _now_iso(),
    })


def save_character_page(world_id: str, page_num: int, character_name: str,
                        data: Dict[str, Any]) -> None:
    """Record a character's page output."""
    extracted = _extract_character_fields(data)

    _db.collection("character_pages").add({
        "world_id": world_id,
        "page_num": page_num,
        "character_name": character_name,
        "inner_thoughts": extracted.get("inner_thoughts"),
        "action": extracted.get("action"),
        "dialogue": extracted.get("dialogue"),
        "emotional_state": extracted.get("emotional_state"),
        "desires_update": extracted.get("desires_update"),
        "raw_json": data,  # native dict
        "created_at": _now_iso(),
    })


def get_page_history(world_id: str, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
    """Get narration history for a world, including character data."""
    query = (
        _db.collection("pages")
        .where(filter=FieldFilter("world_id", "==", world_id))
    )
    all_rows = list(query.stream())
    # Sort in Python to avoid Firestore composite index requirement
    all_rows.sort(key=lambda s: s.to_dict().get("page_num", 0), reverse=True)
    rows = all_rows[offset:offset + limit]

    results = []
    for snap in reversed(rows):
        r = snap.to_dict()
        page_number = r["page_num"]

        # Fetch character data for this page
        char_query = (
            _db.collection("character_pages")
            .where(filter=FieldFilter("world_id", "==", world_id))
            .where(filter=FieldFilter("page_num", "==", page_number))
        )
        characters = {}
        for cs in char_query.stream():
            cd = cs.to_dict()
            characters[cd["character_name"]] = {
                "inner_thoughts": cd.get("inner_thoughts"),
                "action": cd.get("action"),
                "dialogue": cd.get("dialogue"),
                "emotional_state": cd.get("emotional_state"),
                "desires_update": cd.get("desires_update"),
            }

        events = r.get("events", [])
        if isinstance(events, str):
            events = json.loads(events)

        results.append({
            "page": page_number,
            "narration": r.get("narration"),
            "events": events,
            "world_time": r.get("world_time"),
            "mood": r.get("mood"),
            "characters": characters,
            "created_at": r.get("created_at"),
        })
    return results


def get_character_history(world_id: str, character_name: str,
                          limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
    """Get a character's thought/action history."""
    query = (
        _db.collection("character_pages")
        .where(filter=FieldFilter("world_id", "==", world_id))
        .where(filter=FieldFilter("character_name", "==", character_name))
    )
    all_rows = list(query.stream())
    all_rows.sort(key=lambda s: s.to_dict().get("page_num", 0), reverse=True)
    rows = all_rows[offset:offset + limit]
    return [
        {
            "page": r.to_dict()["page_num"],
            "inner_thoughts": r.to_dict().get("inner_thoughts"),
            "action": r.to_dict().get("action"),
            "dialogue": r.to_dict().get("dialogue"),
            "emotional_state": r.to_dict().get("emotional_state"),
            "desires_update": r.to_dict().get("desires_update"),
            "created_at": r.to_dict().get("created_at"),
        }
        for r in reversed(rows)
    ]


def get_debug_data(world_id: str, limit: int = 20, offset: int = 0,
                   include_raw: bool = True) -> Dict[str, Any]:
    """Get raw database data for debugging."""
    # Pages
    all_page_snaps = list(
        _db.collection("pages")
        .where(filter=FieldFilter("world_id", "==", world_id))
        .stream()
    )
    all_page_snaps.sort(key=lambda s: s.to_dict().get("page_num", 0), reverse=True)
    page_snaps = all_page_snaps[offset:offset + limit]
    pages = []
    for snap in page_snaps:
        r = snap.to_dict()
        events = r.get("events", [])
        if isinstance(events, str):
            events = json.loads(events)
        pages.append({
            "id": snap.id,
            "page": r["page_num"],
            "narration": r.get("narration"),
            "events": events,
            "world_time": r.get("world_time"),
            "mood": r.get("mood"),
            "created_at": r.get("created_at"),
        })

    # Character pages
    all_char_snaps = list(
        _db.collection("character_pages")
        .where(filter=FieldFilter("world_id", "==", world_id))
        .stream()
    )
    all_char_snaps.sort(key=lambda s: s.to_dict().get("page_num", 0), reverse=True)
    char_page_snaps = all_char_snaps[offset:offset + limit * 3]
    character_pages = []
    for snap in char_page_snaps:
        r = snap.to_dict()
        raw_json = r.get("raw_json")
        raw_parsed = None
        is_refusal = False
        parse_error = None

        if raw_json is not None:
            if isinstance(raw_json, str):
                try:
                    raw_parsed = json.loads(raw_json)
                except json.JSONDecodeError as e:
                    parse_error = str(e)
            else:
                raw_parsed = raw_json

            if raw_parsed and isinstance(raw_parsed, dict):
                raw_content = raw_parsed.get("raw", "")
                if isinstance(raw_content, str):
                    is_refusal = _is_refusal(raw_content)

        entry = {
            "id": snap.id,
            "page": r["page_num"],
            "character_name": r.get("character_name"),
            "inner_thoughts": r.get("inner_thoughts"),
            "action": r.get("action"),
            "dialogue": r.get("dialogue"),
            "emotional_state": r.get("emotional_state"),
            "desires_update": r.get("desires_update"),
            "created_at": r.get("created_at"),
            "is_refusal": is_refusal,
            "parse_error": parse_error,
            "has_extracted_data": bool(
                r.get("inner_thoughts") or r.get("action") or r.get("dialogue")
            ),
        }
        if include_raw:
            entry["raw_json"] = raw_parsed
        character_pages.append(entry)

    # Stats
    all_pages = list(
        _db.collection("pages")
        .where(filter=FieldFilter("world_id", "==", world_id))
        .stream()
    )
    total_pages = len(all_pages)

    all_chars = list(
        _db.collection("character_pages")
        .where(filter=FieldFilter("world_id", "==", world_id))
        .stream()
    )
    total_character_pages = len(all_chars)

    refusals = 0
    successfully_parsed = 0
    for snap in all_chars:
        d = snap.to_dict()
        if d.get("inner_thoughts") is not None:
            successfully_parsed += 1
        elif d.get("raw_json") is not None:
            refusals += 1

    stats = {
        "total_pages": total_pages,
        "total_character_pages": total_character_pages,
        "refusals": refusals,
        "successfully_parsed": successfully_parsed,
    }

    return {
        "world_id": world_id,
        "pages": pages,
        "character_pages": character_pages,
        "stats": stats,
    }


def get_remembered_characters(world_id: str, global_search: bool = True) -> List[Dict[str, Any]]:
    """Get characters who have appeared in stories, with personality derived from history."""
    if global_search:
        all_snaps = list(_db.collection("character_pages").stream())
    else:
        all_snaps = list(
            _db.collection("character_pages")
            .where(filter=FieldFilter("world_id", "==", world_id))
            .stream()
        )

    # Group by character_name
    from collections import defaultdict
    char_data = defaultdict(list)
    for snap in all_snaps:
        d = snap.to_dict()
        char_data[d["character_name"]].append(d)

    characters = []
    for name, entries in char_data.items():
        appearances = len(entries)
        last_page = max(e["page_num"] for e in entries)
        # Pick any world_id (use most recent entry)
        char_world = max(entries, key=lambda e: e["page_num"])["world_id"]

        # Most recent emotional state
        emotional_entries = [
            e for e in entries if e.get("emotional_state")
        ]
        emotional_state = None
        if emotional_entries:
            emotional_state = max(
                emotional_entries, key=lambda e: e["page_num"]
            )["emotional_state"]

        # Sample dialogue (last 3 distinct)
        dialogue_entries = [
            e["dialogue"] for e in sorted(entries, key=lambda e: e["page_num"], reverse=True)
            if e.get("dialogue")
        ]
        seen_dialogues = []
        for d in dialogue_entries:
            if d not in seen_dialogues:
                seen_dialogues.append(d)
            if len(seen_dialogues) >= 3:
                break

        # Sample actions (last 2 distinct)
        action_entries = [
            e["action"] for e in sorted(entries, key=lambda e: e["page_num"], reverse=True)
            if e.get("action")
        ]
        seen_actions = []
        for a in action_entries:
            if a not in seen_actions:
                seen_actions.append(a)
            if len(seen_actions) >= 2:
                break

        personality_parts = []
        if emotional_state:
            personality_parts.append(f"Currently: {emotional_state}")
        if seen_dialogues:
            sample = seen_dialogues[0][:100]
            if len(seen_dialogues[0]) > 100:
                sample += "..."
            personality_parts.append(f'Says things like: "{sample}"')

        characters.append({
            "name": name,
            "appearances": appearances,
            "last_seen_page": last_page,
            "from_current_world": char_world == world_id,
            "emotional_state": emotional_state,
            "personality": " | ".join(personality_parts) if personality_parts else None,
            "sample_dialogue": seen_dialogues,
            "sample_actions": seen_actions,
        })

    # Sort by appearances descending
    characters.sort(key=lambda c: c["appearances"], reverse=True)
    return characters


def get_full_page(world_id: str, page_num: int) -> Optional[Dict[str, Any]]:
    """Get everything that happened on a specific page."""
    query = (
        _db.collection("pages")
        .where(filter=FieldFilter("world_id", "==", world_id))
        .where(filter=FieldFilter("page_num", "==", page_num))
        .limit(1)
    )
    snaps = list(query.stream())
    if not snaps:
        return None
    r = snaps[0].to_dict()

    char_query = (
        _db.collection("character_pages")
        .where(filter=FieldFilter("world_id", "==", world_id))
        .where(filter=FieldFilter("page_num", "==", page_num))
    )
    characters = {}
    for cs in char_query.stream():
        cd = cs.to_dict()
        characters[cd["character_name"]] = {
            "inner_thoughts": cd.get("inner_thoughts"),
            "action": cd.get("action"),
            "dialogue": cd.get("dialogue"),
            "emotional_state": cd.get("emotional_state"),
            "desires_update": cd.get("desires_update"),
        }

    events = r.get("events", [])
    if isinstance(events, str):
        events = json.loads(events)

    return {
        "page": r["page_num"],
        "narration": r.get("narration"),
        "events": events,
        "world_time": r.get("world_time"),
        "mood": r.get("mood"),
        "characters": characters,
    }


def get_page_count(world_id: str) -> int:
    """Get total page count for a world."""
    snaps = list(
        _db.collection("pages")
        .where(filter=FieldFilter("world_id", "==", world_id))
        .stream()
    )
    return len(snaps)


def get_page(world_id: str, page_num: int) -> Optional[Dict[str, Any]]:
    """Get a specific page by number."""
    query = (
        _db.collection("pages")
        .where(filter=FieldFilter("world_id", "==", world_id))
        .where(filter=FieldFilter("page_num", "==", page_num))
        .limit(1)
    )
    snaps = list(query.stream())
    if not snaps:
        return None

    r = snaps[0].to_dict()
    events = r.get("events", [])
    if isinstance(events, str):
        events = json.loads(events)

    return {
        "page": r["page_num"],
        "narration": r.get("narration"),
        "mood": r.get("mood"),
        "world_time": r.get("world_time"),
        "events": events,
        "created_at": r.get("created_at"),
    }


def get_character_pages(world_id: str, page_num: int) -> List[Dict[str, Any]]:
    """Get character data for a specific page."""
    query = (
        _db.collection("character_pages")
        .where(filter=FieldFilter("world_id", "==", world_id))
        .where(filter=FieldFilter("page_num", "==", page_num))
    )
    results = []
    for snap in query.stream():
        d = snap.to_dict()
        results.append({
            "character_name": d.get("character_name"),
            "action": d.get("action"),
            "dialogue": d.get("dialogue"),
            "emotional_state": d.get("emotional_state"),
            "inner_thoughts": d.get("inner_thoughts"),
            "desires_update": d.get("desires_update"),
        })
    return results


# ===========================================================================
# Potential Characters
# ===========================================================================

def save_potential_character(world_id: str, name: str, description: str, page_num: int) -> None:
    """Insert or update (increment mention count) a potential character."""
    doc_id = f"{world_id}_{name}"
    doc_ref = _db.collection("potential_characters").document(doc_id)
    doc = doc_ref.get()

    if doc.exists:
        doc_ref.update({
            "times_mentioned": firestore.Increment(1),
        })
    else:
        doc_ref.set({
            "world_id": world_id,
            "name": name,
            "description": description,
            "first_page": page_num,
            "times_mentioned": 1,
            "promoted": False,
            "promoted_at": None,
            "created_at": _now_iso(),
        })


def get_potential_characters(world_id: str, include_promoted: bool = False) -> List[Dict[str, Any]]:
    """List potential characters for a world."""
    query = _db.collection("potential_characters").where(filter=FieldFilter("world_id", "==", world_id))
    if not include_promoted:
        query = query.where(filter=FieldFilter("promoted", "==", False))

    rows = list(query.stream())
    results = []
    for snap in rows:
        r = snap.to_dict()
        results.append({
            "name": r["name"],
            "description": r.get("description"),
            "first_page": r["first_page"],
            "times_mentioned": r.get("times_mentioned", 1),
            "promoted": bool(r.get("promoted", False)),
            "promoted_at": r.get("promoted_at"),
            "created_at": r.get("created_at"),
        })

    # Sort: times_mentioned DESC, first_page ASC
    results.sort(key=lambda x: (-x["times_mentioned"], x["first_page"]))
    return results


def get_potential_character(world_id: str, name: str) -> Optional[Dict[str, Any]]:
    """Get a single potential character by name."""
    doc_id = f"{world_id}_{name}"
    doc = _db.collection("potential_characters").document(doc_id).get()
    if not doc.exists:
        return None

    r = doc.to_dict()
    return {
        "name": r["name"],
        "description": r.get("description"),
        "first_page": r["first_page"],
        "times_mentioned": r.get("times_mentioned", 1),
        "promoted": bool(r.get("promoted", False)),
        "promoted_at": r.get("promoted_at"),
        "created_at": r.get("created_at"),
    }


def promote_character(world_id: str, name: str) -> bool:
    """Mark a potential character as promoted."""
    doc_id = f"{world_id}_{name}"
    doc_ref = _db.collection("potential_characters").document(doc_id)
    doc = doc_ref.get()
    if not doc.exists:
        return False

    d = doc.to_dict()
    if d.get("promoted"):
        return False

    doc_ref.update({
        "promoted": True,
        "promoted_at": _now_iso(),
    })
    return True


# ===========================================================================
# Alpha Dashboard Functions
# ===========================================================================

def get_alpha_message() -> Optional[Dict[str, Any]]:
    """Get the hero/dev message for the alpha dashboard."""
    doc = _db.collection("alpha_messages").document("current").get()
    if not doc.exists:
        return None

    r = doc.to_dict()
    return {
        "id": doc.id,
        "content": r.get("content"),
        "updated_at": r.get("updated_at"),
    }


def set_alpha_message(content: str) -> Dict[str, Any]:
    """Set/update the hero message."""
    now = _now_iso()
    _db.collection("alpha_messages").document("current").set({
        "content": content,
        "updated_at": now,
    })
    return get_alpha_message()


# ===========================================================================
# Feedback Functions
# ===========================================================================

def get_feedback_items(voter_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Get all feedback items with vote counts and user vote status."""
    snaps = list(_db.collection("feedback_items").stream())

    items = []
    for snap in snaps:
        r = snap.to_dict()
        item = {
            "id": snap.id,
            "title": r.get("title"),
            "notes": r.get("notes"),
            "status": r.get("status", "requests"),
            "outcome": r.get("outcome"),
            "outcome_notes": r.get("outcome_notes"),
            "upvotes": r.get("upvotes", 0),
            "created_at": r.get("created_at"),
            "updated_at": r.get("updated_at"),
        }
        if voter_id:
            vote_doc = (
                _db.collection("feedback_items")
                .document(snap.id)
                .collection("votes")
                .document(voter_id)
                .get()
            )
            item["has_voted"] = vote_doc.exists
        items.append(item)

    # Sort by status order, then upvotes DESC, then created_at DESC
    status_order = {"planned": 1, "considering": 2, "requests": 3, "results": 4}
    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)  # newest first
    items.sort(key=lambda x: -(x["upvotes"] or 0))  # most upvoted first (stable)
    items.sort(key=lambda x: status_order.get(x["status"], 99))  # status order (stable)
    return items


def create_feedback_item(title: str, notes: Optional[str], status: str = "requests") -> Dict[str, Any]:
    """Create a new feedback item."""
    now = _now_iso()
    _, doc_ref = _db.collection("feedback_items").add({
        "title": title,
        "notes": notes,
        "status": status,
        "outcome": None,
        "outcome_notes": None,
        "upvotes": 0,
        "created_at": now,
        "updated_at": now,
    })
    doc = doc_ref.get()
    r = doc.to_dict()
    return {
        "id": doc.id,
        "title": r["title"],
        "notes": r.get("notes"),
        "status": r["status"],
        "outcome": r.get("outcome"),
        "outcome_notes": r.get("outcome_notes"),
        "upvotes": r.get("upvotes", 0),
        "created_at": r.get("created_at"),
        "updated_at": r.get("updated_at"),
    }


def update_feedback_item(item_id: int, status: Optional[str] = None,
                         outcome: Optional[str] = None, outcome_notes: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Update a feedback item's status/outcome."""
    doc_ref = _db.collection("feedback_items").document(str(item_id))
    doc = doc_ref.get()
    if not doc.exists:
        return None

    updates = {"updated_at": _now_iso()}
    if status is not None:
        updates["status"] = status
    if outcome is not None:
        updates["outcome"] = outcome
    if outcome_notes is not None:
        updates["outcome_notes"] = outcome_notes

    doc_ref.update(updates)
    doc = doc_ref.get()
    r = doc.to_dict()
    return {
        "id": doc.id,
        "title": r["title"],
        "notes": r.get("notes"),
        "status": r["status"],
        "outcome": r.get("outcome"),
        "outcome_notes": r.get("outcome_notes"),
        "upvotes": r.get("upvotes", 0),
        "created_at": r.get("created_at"),
        "updated_at": r.get("updated_at"),
    }


def delete_feedback_item(item_id: int) -> bool:
    """Delete a feedback item and its votes subcollection."""
    doc_ref = _db.collection("feedback_items").document(str(item_id))
    doc = doc_ref.get()
    if not doc.exists:
        return False

    # Delete votes subcollection
    _delete_collection(doc_ref.collection("votes"))

    doc_ref.delete()
    return True


def vote_feedback_item(item_id: int, voter_id: str) -> bool:
    """Toggle a vote on a feedback item. Returns True if voted, False if unvoted."""
    item_id_str = str(item_id)

    @firestore.transactional
    def toggle_vote(transaction):
        item_ref = _db.collection("feedback_items").document(item_id_str)
        vote_ref = item_ref.collection("votes").document(voter_id)

        item_snap = item_ref.get(transaction=transaction)
        if not item_snap.exists:
            raise ValueError("Feedback item not found")

        vote_snap = vote_ref.get(transaction=transaction)
        current_upvotes = item_snap.to_dict().get("upvotes", 0)

        if vote_snap.exists:
            transaction.delete(vote_ref)
            transaction.update(item_ref, {"upvotes": current_upvotes - 1})
            return False
        else:
            transaction.set(vote_ref, {"voter_id": voter_id, "created_at": _now_iso()})
            transaction.update(item_ref, {"upvotes": current_upvotes + 1})
            return True

    transaction = _db.transaction()
    return toggle_vote(transaction)


# ===========================================================================
# Poll Functions
# ===========================================================================

def get_polls(voter_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Get all polls with options and user vote status."""
    snaps = list(_db.collection("polls").stream())

    polls = []
    for snap in snaps:
        r = snap.to_dict()
        poll_id = snap.id

        # Get options
        option_snaps = list(
            _db.collection("polls").document(poll_id)
            .collection("options")
            .order_by("vote_count", direction=firestore.Query.DESCENDING)
            .stream()
        )
        options = [
            {
                "id": o.id,
                "label": o.to_dict().get("label"),
                "vote_count": o.to_dict().get("vote_count", 0),
                "submitted_by": o.to_dict().get("submitted_by"),
            }
            for o in option_snaps
        ]

        poll = {
            "id": poll_id,
            "question": r.get("question"),
            "poll_type": r.get("poll_type", "single"),
            "max_selections": r.get("max_selections", 1),
            "allow_submissions": bool(r.get("allow_submissions", True)),
            "show_live_results": bool(r.get("show_live_results", True)),
            "closes_at": r.get("closes_at"),
            "is_closed": bool(r.get("is_closed", False)),
            "created_at": r.get("created_at"),
            "options": options,
        }

        if voter_id:
            vote_snaps = list(
                _db.collection("polls").document(poll_id)
                .collection("votes")
                .where(filter=FieldFilter("voter_id", "==", voter_id))
                .stream()
            )
            poll["user_votes"] = [v.to_dict()["option_id"] for v in vote_snaps]

        polls.append(poll)

    # Sort: is_closed ASC, created_at DESC
    polls.sort(key=lambda p: p.get("created_at") or "", reverse=True)  # newest first (stable)
    polls.sort(key=lambda p: p["is_closed"])  # open polls first (stable)
    return polls


def create_poll(question: str, poll_type: str, max_selections: int,
                allow_submissions: bool, show_live_results: bool,
                options: List[str], closes_at: Optional[str] = None) -> Dict[str, Any]:
    """Create a new poll with options."""
    now = _now_iso()
    _, poll_ref = _db.collection("polls").add({
        "question": question,
        "poll_type": poll_type,
        "max_selections": max_selections,
        "allow_submissions": allow_submissions,
        "show_live_results": show_live_results,
        "closes_at": closes_at,
        "is_closed": False,
        "created_at": now,
    })

    for label in options:
        poll_ref.collection("options").add({
            "label": label,
            "vote_count": 0,
            "submitted_by": None,
        })

    return get_polls()[0]  # Return the newly created poll


def add_poll_option(poll_id: int, label: str, submitted_by: Optional[str] = None) -> Dict[str, Any]:
    """Add an option to a poll (user submission)."""
    poll_id_str = str(poll_id)
    _, option_ref = (
        _db.collection("polls")
        .document(poll_id_str)
        .collection("options")
        .add({
            "label": label,
            "vote_count": 0,
            "submitted_by": submitted_by,
        })
    )
    doc = option_ref.get()
    d = doc.to_dict()
    return {
        "id": doc.id,
        "label": d["label"],
        "vote_count": d.get("vote_count", 0),
        "submitted_by": d.get("submitted_by"),
    }


def vote_poll(poll_id: int, option_ids: List[int], voter_id: str) -> bool:
    """Submit votes for a poll. Replaces any existing votes."""
    poll_id_str = str(poll_id)
    option_id_strs = [str(oid) for oid in option_ids]

    @firestore.transactional
    def do_vote(transaction):
        poll_ref = _db.collection("polls").document(poll_id_str)
        votes_coll = poll_ref.collection("votes")
        options_coll = poll_ref.collection("options")

        # Find and remove existing votes for this voter
        existing_votes = list(
            votes_coll.where(filter=FieldFilter("voter_id", "==", voter_id)).stream()
        )
        for ev in existing_votes:
            ev_data = ev.to_dict()
            old_option_id = ev_data["option_id"]
            old_option_ref = options_coll.document(str(old_option_id))
            old_option_snap = old_option_ref.get(transaction=transaction)
            if old_option_snap.exists:
                current_count = old_option_snap.to_dict().get("vote_count", 0)
                transaction.update(old_option_ref, {"vote_count": max(0, current_count - 1)})
            transaction.delete(ev.reference)

        # Add new votes
        for option_id in option_id_strs:
            vote_doc_id = f"{voter_id}_{option_id}"
            vote_ref = votes_coll.document(vote_doc_id)
            transaction.set(vote_ref, {
                "poll_id": poll_id_str,
                "option_id": option_id,
                "voter_id": voter_id,
            })
            option_ref = options_coll.document(option_id)
            option_snap = option_ref.get(transaction=transaction)
            if option_snap.exists:
                current_count = option_snap.to_dict().get("vote_count", 0)
                transaction.update(option_ref, {"vote_count": current_count + 1})

        return True

    transaction = _db.transaction()
    return do_vote(transaction)


def close_poll(poll_id: int) -> bool:
    """Close a poll."""
    doc_ref = _db.collection("polls").document(str(poll_id))
    doc = doc_ref.get()
    if not doc.exists:
        return False
    doc_ref.update({"is_closed": True})
    return True


def delete_poll(poll_id: int) -> bool:
    """Delete a poll and its options/votes subcollections."""
    poll_id_str = str(poll_id)
    doc_ref = _db.collection("polls").document(poll_id_str)
    doc = doc_ref.get()
    if not doc.exists:
        return False

    # Delete subcollections
    _delete_collection(doc_ref.collection("options"))
    _delete_collection(doc_ref.collection("votes"))

    doc_ref.delete()
    return True


# ===========================================================================
# Living Library Functions
# ===========================================================================

def create_librarian(nickname: str, kinde_user_id: Optional[str] = None) -> Dict[str, Any]:
    """Create a new librarian and return their data."""
    # Check for existing librarian with this Kinde ID
    if kinde_user_id:
        existing = get_librarian_by_kinde_id(kinde_user_id)
        if existing:
            return existing

    librarian_id = str(uuid.uuid4())[:8]
    now = _now_iso()

    _db.collection("librarians").document(librarian_id).set({
        "id": librarian_id,
        "nickname": nickname,
        "kinde_user_id": kinde_user_id,
        "last_active_book_id": None,
        "created_at": now,
    })

    return get_librarian(librarian_id)


def get_librarian(librarian_id: str) -> Optional[Dict[str, Any]]:
    """Get a librarian by ID."""
    doc = _db.collection("librarians").document(librarian_id).get()
    if not doc.exists:
        return None

    r = doc.to_dict()
    return {
        "id": r.get("id", doc.id),
        "nickname": r.get("nickname"),
        "kinde_user_id": r.get("kinde_user_id"),
        "last_active_book_id": r.get("last_active_book_id"),
        "created_at": r.get("created_at"),
    }


def get_librarian_by_kinde_id(kinde_user_id: str) -> Optional[Dict[str, Any]]:
    """Get a librarian by their Kinde user ID."""
    query = (
        _db.collection("librarians")
        .where(filter=FieldFilter("kinde_user_id", "==", kinde_user_id))
        .limit(1)
    )
    snaps = list(query.stream())
    if not snaps:
        return None

    r = snaps[0].to_dict()
    return {
        "id": r.get("id", snaps[0].id),
        "nickname": r.get("nickname"),
        "kinde_user_id": r.get("kinde_user_id"),
        "last_active_book_id": r.get("last_active_book_id"),
        "created_at": r.get("created_at"),
    }


def set_librarian_last_active_book(librarian_id: str, book_id: Optional[str]) -> bool:
    """Set the last active book for a librarian."""
    doc_ref = _db.collection("librarians").document(librarian_id)
    doc = doc_ref.get()
    if not doc.exists:
        return False
    doc_ref.update({"last_active_book_id": book_id})
    return True


def _generate_bookmark() -> str:
    """Generate a bookmark in ABCD-1234 format."""
    letters = ''.join(random.choices(string.ascii_uppercase, k=4))
    digits = ''.join(random.choices(string.digits, k=4))
    return f"{letters}-{digits}"


def _get_unique_bookmark() -> str:
    """Generate a unique bookmark, checking for collisions."""
    for _ in range(100):
        bookmark = _generate_bookmark()
        # Check collision using the uppercase field
        query = (
            _db.collection("books")
            .where(filter=FieldFilter("bookmark_upper", "==", bookmark.upper()))
            .limit(1)
        )
        if not list(query.stream()):
            return bookmark
    raise RuntimeError("Failed to generate unique bookmark")


def create_book(scenario_name: str, owner_id: str, private: bool = True) -> Dict[str, Any]:
    """Create a new book and return its data."""
    book_id = str(uuid.uuid4())[:8]
    bookmark = _get_unique_bookmark()
    now = _now_iso()

    _db.collection("books").document(book_id).set({
        "id": book_id,
        "bookmark": bookmark,
        "bookmark_upper": bookmark.upper(),
        "scenario_name": scenario_name,
        "owner_id": owner_id,
        "private": private,
        "created_at": now,
        "last_active": now,
        "page_count": 0,
    })

    # Add owner to book_access subcollection
    _db.collection("books").document(book_id).collection("access").document(owner_id).set({
        "book_id": book_id,
        "librarian_id": owner_id,
        "role": "owner",
    })

    return get_book(book_id)


def get_book(book_id: str) -> Optional[Dict[str, Any]]:
    """Get a book by ID."""
    doc = _db.collection("books").document(book_id).get()
    if not doc.exists:
        return None

    r = doc.to_dict()
    page_count = r.get("page_count", 0)

    # Fallback: calculate page count from pages collection if stored count is 0
    if page_count == 0:
        pages_query = (
            _db.collection("pages")
            .where(filter=FieldFilter("world_id", "==", book_id))
            .order_by("page_num", direction=firestore.Query.DESCENDING)
            .limit(1)
        )
        pages = list(pages_query.stream())
        if pages:
            page_count = pages[0].to_dict().get("page_num", 0)

    return {
        "id": r.get("id", doc.id),
        "bookmark": r.get("bookmark"),
        "scenario_name": r.get("scenario_name"),
        "owner_id": r.get("owner_id"),
        "private": bool(r.get("private", False)),
        "created_at": r.get("created_at"),
        "last_active": r.get("last_active"),
        "page_count": page_count,
        "page_interval": r.get("page_interval", 0),
    }


def get_book_by_bookmark(bookmark: str) -> Optional[Dict[str, Any]]:
    """Get a book by bookmark (case-insensitive)."""
    query = (
        _db.collection("books")
        .where(filter=FieldFilter("bookmark_upper", "==", bookmark.upper()))
        .limit(1)
    )
    snaps = list(query.stream())
    if not snaps:
        return None

    r = snaps[0].to_dict()
    return {
        "id": r.get("id", snaps[0].id),
        "bookmark": r.get("bookmark"),
        "scenario_name": r.get("scenario_name"),
        "owner_id": r.get("owner_id"),
        "private": bool(r.get("private", False)),
        "created_at": r.get("created_at"),
        "last_active": r.get("last_active"),
        "page_count": r.get("page_count", 0),
        "page_interval": r.get("page_interval", 0),
    }


def count_books_for_librarian(librarian_id: str) -> int:
    """Count books owned by a librarian."""
    query = (
        _db.collection("books")
        .where(filter=FieldFilter("owner_id", "==", librarian_id))
    )
    return len(list(query.stream()))


def list_books_for_librarian(librarian_id: str) -> List[Dict[str, Any]]:
    """List all books accessible to a librarian."""
    # Query books owned by this librarian (no collection_group needed)
    query = (
        _db.collection("books")
        .where(filter=FieldFilter("owner_id", "==", librarian_id))
    )
    results = []
    for snap in query.stream():
        book = get_book(snap.id)
        if book:
            book["role"] = "owner"
            results.append(book)

    # Also find books where librarian has been granted access via subcollection
    # (check each book's access subcollection individually — avoids collection_group index)
    # For now, just return owned books — shared access can be added later

    # Sort by last_active DESC
    results.sort(key=lambda b: b.get("last_active") or "", reverse=True)
    return results


def delete_book(book_id: str) -> bool:
    """Delete a book and its access subcollection."""
    doc_ref = _db.collection("books").document(book_id)
    doc = doc_ref.get()
    if not doc.exists:
        return False

    # Delete access subcollection
    _delete_collection(doc_ref.collection("access"))

    doc_ref.delete()
    return True


def reset_book(book_id: str) -> bool:
    """Reset a book - deletes all pages and characters, resets page count."""
    doc_ref = _db.collection("books").document(book_id)
    doc = doc_ref.get()
    if not doc.exists:
        return False

    # Delete pages for this book
    pages_query = _db.collection("pages").where(filter=FieldFilter("world_id", "==", book_id))
    for snap in pages_query.stream():
        snap.reference.delete()

    # Delete character pages for this book
    char_query = _db.collection("character_pages").where(filter=FieldFilter("world_id", "==", book_id))
    for snap in char_query.stream():
        snap.reference.delete()

    # Delete potential characters for this book
    pc_query = _db.collection("potential_characters").where(filter=FieldFilter("world_id", "==", book_id))
    for snap in pc_query.stream():
        snap.reference.delete()

    # Reset page count
    doc_ref.update({
        "page_count": 0,
        "last_active": _now_iso(),
    })

    return True


def grant_book_access(book_id: str, librarian_id: str, role: str = "reader") -> None:
    """Grant a librarian access to a book."""
    _db.collection("books").document(book_id).collection("access").document(librarian_id).set({
        "book_id": book_id,
        "librarian_id": librarian_id,
        "role": role,
    }, merge=True)


def list_public_books() -> List[Dict[str, Any]]:
    """List all public books."""
    query = _db.collection("books").where(filter=FieldFilter("private", "==", False))
    results = []
    for snap in query.stream():
        book = get_book(snap.id)
        if book:
            results.append(book)
    # Sort by last_active DESC
    results.sort(key=lambda b: b.get("last_active") or "", reverse=True)
    return results


# Default public book configuration
DEFAULT_PUBLIC_BOOK_ID = "public-library"
DEFAULT_PUBLIC_BOOKMARK = "LIBR-0001"
DEFAULT_PUBLIC_SCENARIO = "the_living_library"  # Use existing scenario
DEFAULT_PUBLIC_PAGE_INTERVAL = 3600  # 1 hour between auto-pages


def ensure_default_public_book() -> Optional[Dict[str, Any]]:
    """Ensure the default public book exists. Creates it if missing."""
    doc = _db.collection("books").document(DEFAULT_PUBLIC_BOOK_ID).get()
    if doc.exists:
        return get_book(DEFAULT_PUBLIC_BOOK_ID)

    # Create the default public book with hourly auto-page
    now = _now_iso()
    _db.collection("books").document(DEFAULT_PUBLIC_BOOK_ID).set({
        "id": DEFAULT_PUBLIC_BOOK_ID,
        "bookmark": DEFAULT_PUBLIC_BOOKMARK,
        "bookmark_upper": DEFAULT_PUBLIC_BOOKMARK.upper(),
        "scenario_name": DEFAULT_PUBLIC_SCENARIO,
        "owner_id": None,  # System-owned
        "private": False,
        "created_at": now,
        "last_active": now,
        "page_count": 0,
        "page_interval": DEFAULT_PUBLIC_PAGE_INTERVAL,
    })

    return get_book(DEFAULT_PUBLIC_BOOK_ID)


# ===========================================================================
# Scenario Functions
# ===========================================================================

def create_scenario(owner_id: str, name: str, description: Optional[str],
                    setting: Optional[str], data: Dict[str, Any], public: bool = False) -> Dict[str, Any]:
    """Create a new scenario and return its data."""
    scenario_id = str(uuid.uuid4())[:8]
    now = _now_iso()

    _db.collection("scenarios").document(scenario_id).set({
        "id": scenario_id,
        "owner_id": owner_id,
        "name": name,
        "name_upper": name.upper(),
        "description": description,
        "setting": setting,
        "data": data,  # native dict
        "public": public,
        "created_at": now,
    })

    return get_scenario(scenario_id)


def get_scenario(scenario_id: str) -> Optional[Dict[str, Any]]:
    """Get a scenario by ID."""
    doc = _db.collection("scenarios").document(scenario_id).get()
    if not doc.exists:
        return None

    r = doc.to_dict()
    data = r.get("data", {})
    if isinstance(data, str):
        data = json.loads(data)

    return {
        "id": r.get("id", doc.id),
        "owner_id": r.get("owner_id"),
        "name": r.get("name"),
        "description": r.get("description"),
        "setting": r.get("setting"),
        "data": data,
        "public": bool(r.get("public", False)),
        "created_at": r.get("created_at"),
    }


def get_scenario_by_name(name: str) -> Optional[Dict[str, Any]]:
    """Get a scenario by name (case-insensitive, public only)."""
    query = (
        _db.collection("scenarios")
        .where(filter=FieldFilter("name_upper", "==", name.upper()))
        .where(filter=FieldFilter("public", "==", True))
    )
    snaps = list(query.stream())
    snaps.sort(key=lambda s: s.to_dict().get("created_at", ""), reverse=True)
    snaps = snaps[:1]
    if not snaps:
        return None

    r = snaps[0].to_dict()
    data = r.get("data", {})
    if isinstance(data, str):
        data = json.loads(data)

    return {
        "id": r.get("id", snaps[0].id),
        "owner_id": r.get("owner_id"),
        "name": r.get("name"),
        "description": r.get("description"),
        "setting": r.get("setting"),
        "data": data,
        "public": bool(r.get("public", False)),
        "created_at": r.get("created_at"),
    }


def list_scenarios_for_librarian(librarian_id: str) -> List[Dict[str, Any]]:
    """List all scenarios owned by a librarian."""
    query = (
        _db.collection("scenarios")
        .where(filter=FieldFilter("owner_id", "==", librarian_id))
    )
    results = []
    for snap in query.stream():
        r = snap.to_dict()
        data = r.get("data", {})
        if isinstance(data, str):
            data = json.loads(data)
        results.append({
            "id": r.get("id", snap.id),
            "owner_id": r.get("owner_id"),
            "name": r.get("name"),
            "description": r.get("description"),
            "setting": r.get("setting"),
            "data": data,
            "public": bool(r.get("public", False)),
            "created_at": r.get("created_at"),
        })
    results.sort(key=lambda s: s.get("created_at", ""), reverse=True)
    return results


def list_public_scenarios() -> List[Dict[str, Any]]:
    """List all public scenarios."""
    query = (
        _db.collection("scenarios")
        .where(filter=FieldFilter("public", "==", True))
    )
    results = []
    for snap in query.stream():
        r = snap.to_dict()
        data = r.get("data", {})
        if isinstance(data, str):
            data = json.loads(data)
        results.append({
            "id": r.get("id", snap.id),
            "owner_id": r.get("owner_id"),
            "name": r.get("name"),
            "description": r.get("description"),
            "setting": r.get("setting"),
            "data": data,
            "public": bool(r.get("public", False)),
            "created_at": r.get("created_at"),
        })
    results.sort(key=lambda s: s.get("created_at", ""), reverse=True)
    return results


def update_scenario(scenario_id: str, name: Optional[str] = None,
                    description: Optional[str] = None, setting: Optional[str] = None,
                    data: Optional[Dict[str, Any]] = None, public: Optional[bool] = None) -> bool:
    """Update a scenario's fields."""
    doc_ref = _db.collection("scenarios").document(scenario_id)
    doc = doc_ref.get()
    if not doc.exists:
        return False

    updates = {}
    if name is not None:
        updates["name"] = name
        updates["name_upper"] = name.upper()
    if description is not None:
        updates["description"] = description
    if setting is not None:
        updates["setting"] = setting
    if data is not None:
        updates["data"] = data  # native dict
    if public is not None:
        updates["public"] = public

    if not updates:
        return False

    doc_ref.update(updates)
    return True


def delete_scenario(scenario_id: str) -> bool:
    """Delete a scenario."""
    doc_ref = _db.collection("scenarios").document(scenario_id)
    doc = doc_ref.get()
    if not doc.exists:
        return False
    doc_ref.delete()
    return True
