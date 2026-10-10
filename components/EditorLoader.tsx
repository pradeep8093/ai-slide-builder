"use client";

import dynamic from "next/dynamic";
import LoadingScreen from "./editor/LoadingScreen";

/**
 * The editor only runs in the browser: the deck lives in IndexedDB and ids/timestamps are created
 * on the client. Skipping SSR keeps the server-rendered shell to a loading state.
 */
const Editor = dynamic(() => import("./Editor"), { ssr: false, loading: () => <LoadingScreen /> });

export default function EditorLoader() {
  return <Editor />;
}
