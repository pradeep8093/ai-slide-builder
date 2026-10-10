export default function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-neutral-100" role="status" aria-live="polite">
      <div className="flex items-center gap-3 text-sm text-neutral-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-indigo-600" aria-hidden />
        Loading your presentation…
      </div>
    </div>
  );
}
