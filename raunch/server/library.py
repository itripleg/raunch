"""Library singleton - manages all active books."""

from typing import Dict, Optional, Tuple, List
import logging

from .book import Book
from .. import db

logger = logging.getLogger(__name__)

# Module-level singleton
_library: Optional["Library"] = None


def get_library() -> "Library":
    """Get or create the Library singleton."""
    global _library
    if _library is None:
        _library = Library()
    return _library


def reset_library() -> None:
    """Reset the library singleton (for testing)."""
    global _library
    _library = None


class BookLimitReached(Exception):
    """Raised when a librarian has too many books."""
    pass


class Library:
    """Manages all active books on this server."""

    MAX_BOOKS_PER_LIBRARIAN = 100

    def __init__(self):
        self.books: Dict[str, Book] = {}
        self._bookmarks: Dict[str, str] = {}  # bookmark -> book_id
        logger.info("Library initialized")

    def open_book(
        self,
        scenario_name: str,
        owner_id: str,
        private: bool = False,
    ) -> Tuple[str, str]:
        """
        Open a new book from a scenario.

        Returns: (book_id, bookmark)
        Raises: BookLimitReached if owner has too many books
        """
        # Check book limit
        existing = db.list_books_for_librarian(owner_id)
        owned = [b for b in existing if b["role"] == "owner"]
        if len(owned) >= self.MAX_BOOKS_PER_LIBRARIAN:
            raise BookLimitReached(
                f"Maximum {self.MAX_BOOKS_PER_LIBRARIAN} books per librarian"
            )

        # Resolve display name from scenario data
        display_name = scenario_name
        try:
            from raunch.wizard import load_scenario
            scenario_data = load_scenario(scenario_name)
            if scenario_data and scenario_data.get("scenario_name"):
                display_name = scenario_data["scenario_name"]
        except Exception:
            pass

        # Create in database
        book_data = db.create_book(display_name, owner_id, private)

        # Create in-memory Book
        book = Book(
            book_id=book_data["id"],
            bookmark=book_data["bookmark"],
            scenario_name=display_name,
            owner_id=owner_id,
            private=private,
        )

        self.books[book.book_id] = book
        self._bookmarks[book.bookmark.upper()] = book.book_id

        logger.info(f"Opened book {book.book_id} ({scenario_name}) for {owner_id}")
        return book.book_id, book.bookmark

    def get_book(self, book_id: str) -> Optional[Book]:
        """Get a book by ID, loading from DB if needed."""
        # Check in-memory first
        if book_id in self.books:
            return self.books[book_id]

        # Try loading from database
        try:
            book_data = db.get_book(book_id)
        except Exception as e:
            # Handle database errors (e.g., thread-local connection issues)
            logger.warning(f"Failed to load book {book_id} from database: {e}")
            return None

        if book_data is None:
            return None

        # Create in-memory Book
        book = Book(
            book_id=book_data["id"],
            bookmark=book_data["bookmark"],
            scenario_name=book_data["scenario_name"],
            owner_id=book_data["owner_id"],
            private=book_data["private"],
        )

        self.books[book.book_id] = book
        self._bookmarks[book.bookmark.upper()] = book.book_id

        logger.info(f"Loaded book {book.book_id} from database")
        return book

    def find_by_bookmark(self, bookmark: str) -> Optional[str]:
        """Find a book ID by bookmark (case-insensitive)."""
        upper = bookmark.upper()

        # Check cache
        if upper in self._bookmarks:
            return self._bookmarks[upper]

        # Check database
        book_data = db.get_book_by_bookmark(bookmark)
        if book_data:
            self._bookmarks[upper] = book_data["id"]
            return book_data["id"]

        return None

    def close_book(self, book_id: str) -> bool:
        """Close a book, removing it from memory and database."""
        book = self.books.pop(book_id, None)

        if book:
            # Remove from bookmark cache
            self._bookmarks.pop(book.bookmark.upper(), None)

            # Stop orchestrator if running
            if book.orchestrator and book.orchestrator._running:
                book.orchestrator.stop()

        # Remove from database
        deleted = db.delete_book(book_id)

        if deleted:
            logger.info(f"Closed book {book_id}")

        return deleted

    def list_books(self, librarian_id: Optional[str] = None) -> List[Dict]:
        """List books, optionally filtered by librarian."""
        if librarian_id:
            return db.list_books_for_librarian(librarian_id)

        # Return all in-memory books (admin view)
        return [
            {
                "id": book.book_id,
                "bookmark": book.bookmark,
                "scenario_name": book.scenario_name,
                "owner_id": book.owner_id,
                "readers": len(book.readers),
            }
            for book in self.books.values()
        ]
