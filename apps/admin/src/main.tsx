import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Toaster } from "@/components/ui/sonner";
import "./index.css";

// ConfirmDialogProvider is mounted inside Shell (App.tsx), not here — every
// useConfirm() call site is post-login, and nesting it under Shell's
// I18nCtx.Provider lets its dialog labels reflect the real selected language.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <Toaster />
  </StrictMode>
);
