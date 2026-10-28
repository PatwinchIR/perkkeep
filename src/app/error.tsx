"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty-state">
      <h1>Something didn’t load.</h1>
      <p>Your saved records are still in your ledger.</p>
      <button className="primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
