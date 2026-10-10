"use client";

import dynamic from "next/dynamic";
import LoadingScreen from "./editor/LoadingScreen";

/**
 * The app only runs in the browser: presentations live in IndexedDB and ids/timestamps are created
 * on the client. Skipping SSR keeps the server-rendered shell to a loading state.
 */
const App = dynamic(() => import("./App"), { ssr: false, loading: () => <LoadingScreen /> });

export default function EditorLoader() {
  return <App />;
}
