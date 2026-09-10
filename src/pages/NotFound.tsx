import { Link } from "react-router";

export default function NotFound() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center"
      style={{ background: "#f7f3ec", fontFamily: "Poppins, system-ui, sans-serif" }}
    >
      <div className="text-center px-6">
        <h1
          className="font-extrabold"
          style={{
            fontSize: "clamp(48px, 10vw, 96px)",
            color: "#2c2420",
            letterSpacing: "-0.03em",
            lineHeight: 1,
            margin: 0,
          }}
        >
          4<span style={{ color: "#b5734a" }}>0</span>4
        </h1>
        <p style={{ color: "#6b5d52", margin: "14px 0 26px", fontSize: 16 }}>
          That page isn't part of the venue.
        </p>
        <Link
          to="/"
          className="inline-flex items-center justify-center"
          style={{
            background: "#b5734a",
            color: "#fff",
            padding: "11px 22px",
            borderRadius: 12,
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Back to Code Venue
        </Link>
      </div>
    </div>
  );
}
