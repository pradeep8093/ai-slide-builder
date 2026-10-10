"use client";

import { useCallback, useSyncExternalStore } from "react";

export type Route = { view: "dashboard" } | { view: "deck"; deckId: string };

/** "#/deck/<id>" opens a presentation; anything else shows the dashboard. */
export function parseHash(hash: string): Route {
  const match = /^#\/deck\/([A-Za-z0-9-]{1,100})$/.exec(hash);
  return match ? { view: "deck", deckId: match[1] } : { view: "dashboard" };
}

export function routeToHash(route: Route): string {
  return route.view === "deck" ? `#/deck/${route.deckId}` : "#/";
}

function subscribe(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

/**
 * The current view, kept in the URL hash so a refresh reopens the same presentation and the
 * browser's back button returns to the dashboard.
 */
export function useHashRoute(): [Route, (route: Route) => void] {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => "");
  const navigate = useCallback((route: Route) => {
    const next = routeToHash(route);
    if (window.location.hash !== next) window.location.hash = next;
  }, []);
  return [parseHash(hash), navigate];
}
