"use client";

import Dashboard from "./dashboard/Dashboard";
import Editor from "./Editor";
import { useHashRoute } from "./hooks/useHashRoute";
import Toasts from "./ui/Toasts";

/** Client-side shell: the dashboard of presentations, or the editor for one of them. */
export default function App() {
  const [route, navigate] = useHashRoute();
  return (
    <>
      {route.view === "deck" ? (
        // A key per deck gives every presentation a fresh editor (stores, history, autosave).
        <Editor key={route.deckId} deckId={route.deckId} onNavigate={navigate} />
      ) : (
        <Dashboard onOpen={(deckId) => navigate({ view: "deck", deckId })} />
      )}
      <Toasts />
    </>
  );
}
