import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

type MockModeContextValue = {
  mockMode: boolean;
  toggleMockMode: () => void;
};

const MockModeContext = createContext<MockModeContextValue>({
  mockMode: false,
  toggleMockMode: () => {},
});

export function MockModeProvider({ children }: { children: ReactNode }) {
  const [mockMode, setMockMode] = useState(() => {
    try {
      return localStorage.getItem("raunch-mock-mode") === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("raunch-mock-mode", mockMode ? "true" : "false");
    } catch {
      // ignore
    }
  }, [mockMode]);

  const toggleMockMode = useCallback(() => setMockMode((m) => !m), []);

  return (
    <MockModeContext.Provider value={{ mockMode, toggleMockMode }}>
      {children}
    </MockModeContext.Provider>
  );
}

export function useMockMode() {
  return useContext(MockModeContext);
}
