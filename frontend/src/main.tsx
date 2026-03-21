import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { KindeProvider } from "@kinde-oss/kinde-auth-react";
import { MockModeProvider } from "./context/MockMode";
import "./index.css";
import App from "./App.tsx";

// Use current origin for OAuth redirects (works for both localhost and production)
const redirectUri = window.location.origin;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <KindeProvider
      clientId="6832647eb9d04352a5d52d2bad569529"
      domain="https://jbuild.kinde.com"
      redirectUri={redirectUri}
      logoutUri={redirectUri}
    >
      <MockModeProvider>
        <App />
      </MockModeProvider>
    </KindeProvider>
  </StrictMode>
);
