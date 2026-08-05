import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmDialogProvider } from "@/hooks/useConfirm";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfirmDialogProvider>
      <App />
      <Toaster />
    </ConfirmDialogProvider>
  </StrictMode>
);
