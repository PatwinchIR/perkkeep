import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty-state">
      <h1>That page isn’t here.</h1>
      <Link href="/">Return to your overview</Link>
    </div>
  );
}
