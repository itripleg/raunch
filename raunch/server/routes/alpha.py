"""Alpha dashboard endpoints — hero message, feedback, polls, admin."""

import os
from typing import List, Optional, Union

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from raunch import db

router = APIRouter(prefix="/api/v1/alpha", tags=["alpha"])

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "joshua.bell.828@gmail.com")
ADMIN_CODE = os.environ.get("ADMIN_CODE", "raunch-alpha-dev")


# ─── Models ───────────────────────────────────────────────────────────────────

class AlphaMessage(BaseModel):
    content: str
    updated_at: Optional[str] = None


class AlphaMessageUpdate(BaseModel):
    content: str
    admin_email: str


class AdminVerifyRequest(BaseModel):
    code: str


class AdminVerifyResponse(BaseModel):
    valid: bool


class AlphaContentResponse(BaseModel):
    content: str


# ─── Hero Message ─────────────────────────────────────────────────────────────

@router.get("/message", response_model=AlphaMessage)
async def get_message():
    """Get the hero/dev message."""
    msg = db.get_alpha_message()
    if msg is None:
        return AlphaMessage(
            content="Welcome to the Raunch alpha! Your feedback shapes what we create.",
            updated_at=None,
        )
    return AlphaMessage(content=msg["content"], updated_at=msg["updated_at"])


@router.put("/message", response_model=AlphaMessage)
async def update_message(req: AlphaMessageUpdate):
    """Update the hero/dev message (admin only)."""
    if req.admin_email.lower() != ADMIN_EMAIL.lower():
        raise HTTPException(status_code=403, detail="Admin access required")
    msg = db.set_alpha_message(req.content)
    return AlphaMessage(content=msg["content"], updated_at=msg["updated_at"])


# ─── Admin ────────────────────────────────────────────────────────────────────

@router.post("/admin/verify", response_model=AdminVerifyResponse)
async def verify_admin(req: AdminVerifyRequest):
    """Verify admin code."""
    return AdminVerifyResponse(valid=req.code == ADMIN_CODE)


# ─── About page content ──────────────────────────────────────────────────────

@router.get("/content/about", response_model=AlphaContentResponse)
async def get_about_content():
    """Get about page content."""
    return AlphaContentResponse(
        content="Raunch is a multi-agent adult interactive fiction engine powered by Claude. "
        "Characters think, feel, and act autonomously. You guide the story as the Librarian."
    )


# ─── Feedback ─────────────────────────────────────────────────────────────────

class FeedbackItem(BaseModel):
    id: Union[int, str]
    title: str
    notes: Optional[str] = None
    status: str
    outcome: Optional[str] = None
    outcome_notes: Optional[str] = None
    upvotes: int = 0
    has_voted: Optional[bool] = None


class FeedbackCreate(BaseModel):
    title: str
    notes: Optional[str] = None


class FeedbackUpdate(BaseModel):
    status: Optional[str] = None
    outcome: Optional[str] = None
    outcome_notes: Optional[str] = None


class VoteRequest(BaseModel):
    voter_id: str


@router.get("/feedback", response_model=List[FeedbackItem])
async def list_feedback():
    """List all feedback items."""
    items = db.get_feedback_items()
    return [FeedbackItem(**item) for item in items]


@router.post("/feedback", response_model=FeedbackItem)
async def create_feedback(req: FeedbackCreate):
    """Create a feedback item."""
    item = db.create_feedback_item(req.title, req.notes)
    return FeedbackItem(**item)


@router.put("/feedback/{item_id}", response_model=FeedbackItem)
async def update_feedback(item_id: str, req: FeedbackUpdate):
    """Update a feedback item."""
    item = db.update_feedback_item(
        item_id,
        status=req.status,
        outcome=req.outcome,
        outcome_notes=req.outcome_notes,
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Feedback item not found")
    return FeedbackItem(**item)


@router.delete("/feedback/{item_id}")
async def delete_feedback(item_id: str):
    """Delete a feedback item."""
    deleted = db.delete_feedback_item(item_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Feedback item not found")
    return {"deleted": True}


@router.post("/feedback/{item_id}/vote")
async def vote_feedback(item_id: str, req: VoteRequest):
    """Toggle vote on a feedback item."""
    result = db.vote_feedback_item(item_id, req.voter_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Feedback item not found")
    return result


# ─── Polls ────────────────────────────────────────────────────────────────────

class PollOption(BaseModel):
    id: Union[int, str]
    text: Optional[str] = None  # SQLite uses "text"
    label: Optional[str] = None  # Firestore uses "label"
    vote_count: int = 0
    submitted_by: Optional[str] = None
    votes: int = 0


class Poll(BaseModel):
    id: Union[int, str]
    question: str
    options: List[PollOption] = []
    closed: bool = False
    is_closed: bool = False
    created_at: Optional[str] = None
    poll_type: Optional[str] = None
    max_selections: int = 1
    allow_submissions: bool = True
    show_live_results: bool = True
    closes_at: Optional[str] = None


class PollCreate(BaseModel):
    question: str
    options: List[str] = []


class PollVoteRequest(BaseModel):
    option_id: Union[int, str]
    voter_id: str


class PollOptionCreate(BaseModel):
    text: str


@router.get("/polls", response_model=List[Poll])
async def list_polls():
    """List all polls."""
    polls = db.get_polls()
    return [Poll(**p) for p in polls]


@router.post("/polls", response_model=Poll)
async def create_poll(req: PollCreate):
    """Create a poll."""
    poll = db.create_poll(req.question, req.options)
    return Poll(**poll)


@router.post("/polls/{poll_id}/vote")
async def vote_poll(poll_id: str, req: PollVoteRequest):
    """Vote on a poll option."""
    result = db.vote_poll(poll_id, req.option_id, req.voter_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Poll not found")
    return result


@router.post("/polls/{poll_id}/options", response_model=PollOption)
async def add_poll_option(poll_id: str, req: PollOptionCreate):
    """Add an option to a poll."""
    option = db.add_poll_option(poll_id, req.text)
    if option is None:
        raise HTTPException(status_code=404, detail="Poll not found")
    return PollOption(**option)


@router.delete("/polls/{poll_id}")
async def delete_poll(poll_id: str):
    """Delete a poll."""
    deleted = db.delete_poll(poll_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Poll not found")
    return {"deleted": True}
