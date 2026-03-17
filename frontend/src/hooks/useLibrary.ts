import { useState, useCallback, useEffect, useRef } from "react";

const LIBRARIAN_STORAGE_PREFIX = "raunch_librarian_id_";

export type BookInfo = {
  book_id: string;
  bookmark: string;
  scenario: string;
  private: boolean;
  librarian_id: string;
  created_at: string;
  page_count?: number;
  active_readers?: number;
};

export interface UseLibraryReturn {
  librarianId: string | null;
  isLoading: boolean;
  error: string | null;
  books: BookInfo[];
  currentBook: BookInfo | null;

  createBook: (scenario: string, isPrivate?: boolean) => Promise<{ bookId: string; bookmark: string }>;
  joinBook: (bookmark: string) => Promise<string>;
  listBooks: () => Promise<BookInfo[]>;
  getBook: (bookId: string) => Promise<BookInfo>;
  deleteBook: (bookId: string) => Promise<void>;
  setCurrentBook: (book: BookInfo | null) => void;
  clearError: () => void;
}

// Get storage key for librarian ID based on server URL
function getStorageKey(apiUrl: string): string {
  // Use URL origin as key to support different servers
  try {
    const url = new URL(apiUrl);
    return `${LIBRARIAN_STORAGE_PREFIX}${url.host}`;
  } catch {
    // Fallback for invalid URLs
    return `${LIBRARIAN_STORAGE_PREFIX}default`;
  }
}

// Get stored librarian ID for a specific server
function getStoredLibrarianId(apiUrl: string): string | null {
  try {
    return localStorage.getItem(getStorageKey(apiUrl));
  } catch {
    return null;
  }
}

// Store librarian ID for a specific server
function setStoredLibrarianId(apiUrl: string, librarianId: string): void {
  try {
    localStorage.setItem(getStorageKey(apiUrl), librarianId);
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

// Clear stored librarian ID for a specific server
function clearStoredLibrarianId(apiUrl: string): void {
  try {
    localStorage.removeItem(getStorageKey(apiUrl));
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

export function useLibrary(apiUrl: string, accessToken?: string | null, kindeUserId?: string | null): UseLibraryReturn {
  const [librarianId, setLibrarianId] = useState<string | null>(() => getStoredLibrarianId(apiUrl));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [books, setBooks] = useState<BookInfo[]>([]);
  const [currentBook, setCurrentBookState] = useState<BookInfo | null>(null);

  // Track if we're currently creating a librarian to prevent duplicate requests
  const creatingLibrarianRef = useRef(false);
  const restoringBookRef = useRef(false);
  const lastActiveBookIdRef = useRef<string | null>(null);

  // Create a new librarian
  const createLibrarian = useCallback(async (kindeId?: string | null): Promise<string> => {
    if (creatingLibrarianRef.current) {
      // Wait for existing creation to complete
      while (creatingLibrarianRef.current) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const storedId = getStoredLibrarianId(apiUrl);
      if (storedId) return storedId;
    }

    creatingLibrarianRef.current = true;
    try {
      // Generate a random nickname for the librarian
      const nickname = `Librarian-${Math.random().toString(36).substring(2, 8)}`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Add auth token if available
      if (accessToken) {
        headers["Authorization"] = `Bearer ${accessToken}`;
      }

      const response = await fetch(`${apiUrl}/api/v1/librarians`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          nickname,
          kinde_user_id: kindeId || undefined,  // Only include if provided
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || `Failed to create librarian: ${response.status}`);
      }

      const data = await response.json();
      const newLibrarianId = data.librarian_id;

      setStoredLibrarianId(apiUrl, newLibrarianId);
      setLibrarianId(newLibrarianId);

      return newLibrarianId;
    } finally {
      creatingLibrarianRef.current = false;
    }
  }, [apiUrl, accessToken]);

  // Lookup librarian by Kinde user ID
  const lookupLibrarianByKinde = useCallback(async (kindeId: string): Promise<string | null> => {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (accessToken) {
        headers["Authorization"] = `Bearer ${accessToken}`;
      }

      const response = await fetch(`${apiUrl}/api/v1/librarians/by-kinde/${encodeURIComponent(kindeId)}`, {
        method: "GET",
        headers,
      });

      if (response.status === 404) {
        return null;  // No librarian for this Kinde user yet
      }

      if (!response.ok) {
        console.error("Failed to lookup librarian by Kinde ID:", response.status);
        return null;
      }

      const data = await response.json();
      return data.librarian_id;
    } catch (err) {
      console.error("Failed to lookup librarian by Kinde ID:", err);
      return null;
    }
  }, [apiUrl, accessToken]);

  // Handle 401 errors by creating a new librarian and retrying
  const fetchWithRetry = useCallback(async (
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> => {
    let currentLibrarianId = librarianId;

    // If no librarian ID, create one first
    if (!currentLibrarianId) {
      currentLibrarianId = await createLibrarian(kindeUserId);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> || {}),
    };

    // Add auth token if available
    if (accessToken) {
      headers["Authorization"] = `Bearer ${accessToken}`;
    }

    if (currentLibrarianId) {
      headers["X-Librarian-ID"] = currentLibrarianId;
    }

    let response = await fetch(`${apiUrl}${endpoint}`, {
      ...options,
      headers,
    });

    // If 401, clear stored ID, create new librarian, and retry
    if (response.status === 401) {
      clearStoredLibrarianId(apiUrl);
      currentLibrarianId = await createLibrarian(kindeUserId);
      headers["X-Librarian-ID"] = currentLibrarianId;

      response = await fetch(`${apiUrl}${endpoint}`, {
        ...options,
        headers,
      });
    }

    return response;
  }, [apiUrl, librarianId, createLibrarian, kindeUserId, accessToken]);

  // Auto-create librarian on mount if none exists, or validate cached one
  useEffect(() => {
    const initLibrarian = async () => {
      // First check localStorage
      const storedId = getStoredLibrarianId(apiUrl);
      if (storedId) {
        // Validate the cached librarian still exists on the server
        try {
          const res = await fetch(`${apiUrl}/api/v1/librarians/${encodeURIComponent(storedId)}`);
          if (res.ok) {
            setLibrarianId(storedId);
            return;
          }
          // Server returned 404 or other error — cached ID is stale
          console.warn("Cached librarian ID is stale, recreating...");
          clearStoredLibrarianId(apiUrl);
        } catch {
          // Server unreachable — use cached ID optimistically
          setLibrarianId(storedId);
          return;
        }
      }

      // If we have a Kinde user ID, try to find their existing librarian
      if (kindeUserId) {
        const existingId = await lookupLibrarianByKinde(kindeUserId);
        if (existingId) {
          setStoredLibrarianId(apiUrl, existingId);
          setLibrarianId(existingId);
          return;
        }
      }

      // No existing librarian found, create a new one (linked to Kinde if available)
      try {
        await createLibrarian(kindeUserId);
        // createLibrarian already stores and sets the ID
      } catch (err) {
        console.error("Failed to auto-create librarian:", err);
      }
    };

    initLibrarian();
  }, [apiUrl, kindeUserId, createLibrarian, lookupLibrarianByKinde]);

  // Restore last active book from server after librarian is loaded
  useEffect(() => {
    const restoreLastActiveBook = async () => {
      if (restoringBookRef.current || !librarianId || currentBook) return;

      restoringBookRef.current = true;
      try {
        // Fetch librarian to get last_active_book_id
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (accessToken) {
          headers["Authorization"] = `Bearer ${accessToken}`;
        }

        const response = await fetch(`${apiUrl}/api/v1/librarians/${encodeURIComponent(librarianId)}`, {
          method: "GET",
          headers,
        });

        if (response.ok) {
          const data = await response.json();
          lastActiveBookIdRef.current = data.last_active_book_id;

          if (data.last_active_book_id) {
            // Fetch the book details
            const bookResponse = await fetch(`${apiUrl}/api/v1/books/${encodeURIComponent(data.last_active_book_id)}`, {
              method: "GET",
              headers: {
                ...headers,
                "X-Librarian-ID": librarianId,
              },
            });

            if (bookResponse.ok) {
              const bookData = await bookResponse.json();
              setCurrentBookState(bookData);
            }
          }
        } else if (response.status === 404) {
          // Librarian was wiped (e.g. Render ephemeral disk reset)
          // Clear cached ID so initLibrarian recreates it
          clearStoredLibrarianId(apiUrl);
          setLibrarianId(null);
        }
      } catch (err) {
        console.error("Failed to restore last active book:", err);
      } finally {
        restoringBookRef.current = false;
      }
    };

    restoreLastActiveBook();
  }, [apiUrl, librarianId, accessToken, currentBook]);

  // Wrapper to update server when current book changes
  const setCurrentBook = useCallback(async (book: BookInfo | null) => {
    setCurrentBookState(book);

    // Update server with new last active book
    if (librarianId && book?.book_id !== lastActiveBookIdRef.current) {
      lastActiveBookIdRef.current = book?.book_id ?? null;
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Librarian-ID": librarianId,
        };
        if (accessToken) {
          headers["Authorization"] = `Bearer ${accessToken}`;
        }

        await fetch(`${apiUrl}/api/v1/librarians/me/last-active-book`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ book_id: book?.book_id ?? null }),
        });
      } catch (err) {
        console.error("Failed to update last active book:", err);
      }
    }
  }, [apiUrl, librarianId, accessToken]);

  // Create a new book
  const createBook = useCallback(async (
    scenario: string,
    isPrivate = false
  ): Promise<{ bookId: string; bookmark: string }> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithRetry("/api/v1/books", {
        method: "POST",
        body: JSON.stringify({
          scenario,
          private: isPrivate,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || `Failed to create book: ${response.status}`);
      }

      const data = await response.json();
      return {
        bookId: data.book_id,
        bookmark: data.bookmark,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create book";
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithRetry]);

  // Join an existing book by bookmark
  const joinBook = useCallback(async (bookmark: string): Promise<string> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithRetry("/api/v1/books/join", {
        method: "POST",
        body: JSON.stringify({ bookmark }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || `Failed to join book: ${response.status}`);
      }

      const data = await response.json();
      return data.book_id;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to join book";
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithRetry]);

  // List all books
  const listBooks = useCallback(async (): Promise<BookInfo[]> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithRetry("/api/v1/books", {
        method: "GET",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || `Failed to list books: ${response.status}`);
      }

      const data = await response.json();
      const bookList = Array.isArray(data) ? data : data.books || [];
      setBooks(bookList);
      return bookList;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list books";
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithRetry]);

  // Get a specific book by ID
  const getBook = useCallback(async (bookId: string): Promise<BookInfo> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithRetry(`/api/v1/books/${encodeURIComponent(bookId)}`, {
        method: "GET",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || `Failed to get book: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get book";
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithRetry]);

  // Delete a book
  const deleteBook = useCallback(async (bookId: string): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithRetry(`/api/v1/books/${encodeURIComponent(bookId)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || `Failed to delete book: ${response.status}`);
      }

      // Remove from local state
      setBooks(prev => prev.filter(b => b.book_id !== bookId));

      // Clear current book if it was deleted
      if (currentBook?.book_id === bookId) {
        setCurrentBook(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete book";
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithRetry, currentBook]);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    librarianId,
    isLoading,
    error,
    books,
    currentBook,
    createBook,
    joinBook,
    listBooks,
    getBook,
    deleteBook,
    setCurrentBook,
    clearError,
  };
}
