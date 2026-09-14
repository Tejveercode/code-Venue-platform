import React, { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import "../src/index.css";
import "../src/index-monitor.css";
import { ExaminerDashboard, type Counts } from "@/components/examiner/ExaminerDashboard";
import { CodeVenuePage, VenueHeader } from "@/components/venue/ui";

// ---------------------------------------------------------------------------
// QA harness — mounts the REAL ExaminerDashboard + VenueHeader with scripted
// scenarios. Playwright picks a scenario via ?scenario= or window.__qaSetScenario.
// ---------------------------------------------------------------------------

type Room = {
  _id: string;
  code: string;
  name: string;
  prompt: string;
  durationMinutes: number;
  status: "LIVE" | "CLOSED";
  enrolledLimit: number;
  startedAt: number;
  endedAt?: number;
  examinerId: string;
  violationLimit?: number;
};

const mkRoom = (over: Partial<Room> & { _id: string; code: string; name: string }): Room => ({
  prompt: "Implement a thread-safe LRU cache with O(1) get and put.",
  durationMinutes: 60,
  status: "LIVE",
  enrolledLimit: 30,
  startedAt: Date.now() - 20 * 60_000,
  examinerId: "ex1",
  ...over,
});

const SCENARIOS: Record<string, { rooms: Room[]; counts: Counts; greetingNew?: boolean }> = {
  // Default: flagged live room + quiet live room + ended room.
  mixed: {
    rooms: [
      mkRoom({ _id: "r1", code: "CV-1522", name: "Intro to Algorithms" }),
      mkRoom({ _id: "r2", code: "CV-8471", name: "Data Structures Midterm" }),
      mkRoom({ _id: "r3", code: "CV-3390", name: "Java OOP Assessment", status: "CLOSED", endedAt: Date.now() - 86_400_000 }),
    ],
    counts: {
      r1: { joined: 27, submitted: 23, flagged: 3, autoSubmitted: 1 },
      r2: { joined: 12, submitted: 4, flagged: 0, autoSubmitted: 0 },
      r3: { joined: 30, submitted: 29, flagged: 0, autoSubmitted: 0 },
    },
  },
  empty: { rooms: [], counts: {} },
  single: {
    rooms: [mkRoom({ _id: "r1", code: "CV-1000", name: "Quiz 1" })],
    counts: { r1: { joined: 1, submitted: 0, flagged: 0, autoSubmitted: 0 } },
  },
  longname: {
    rooms: [
      mkRoom({
        _id: "r1",
        code: "CV-9999",
        name: "Advanced Distributed Systems and Consensus Protocols — Final Examination Section B (Spring Term)",
        durationMinutes: 150,
      }),
    ],
    counts: { r1: { joined: 30, submitted: 12, flagged: 0, autoSubmitted: 0 } },
  },
  nostudents: {
    rooms: [mkRoom({ _id: "r1", code: "CV-4242", name: "Not Started Yet" })],
    counts: { r1: { joined: 0, submitted: 0, flagged: 0, autoSubmitted: 0 } },
  },
  many: {
    rooms: Array.from({ length: 9 }, (_, i) =>
      mkRoom({
        _id: `r${i}`,
        code: `CV-1${String(i).padStart(3, "0")}`,
        name: `Assessment ${i + 1}`,
        status: i >= 6 ? "CLOSED" : "LIVE",
      }),
    ),
    counts: Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [
        `r${i}`,
        { joined: 20 + i, submitted: i * 2, flagged: i === 2 ? 2 : 0, autoSubmitted: 0 },
      ]),
    ),
  },
};

function QAApp({ scenarioKey }: { scenarioKey: string }) {
  const scenario = SCENARIOS[scenarioKey] ?? SCENARIOS.mixed!;
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    (window as unknown as { __qaToast?: unknown }).__qaToast = toast;
  }, [toast]);

  return (
    // CodeVenuePage — the production shell (mounts VoidFieldCanvas + veil).
    <CodeVenuePage>
      <VenueHeader />
      <ExaminerDashboard
        examinerName="Tejveer Singh"
        greetingNew={scenario.greetingNew ?? false}
        rooms={scenario.rooms}
        counts={scenario.counts}
        onCreate={() => setToast("create")}
        onEnd={() => setToast("end")}
        onProfile={() => setToast("profile")}
      />
      {toast && <div id="qa-toast">{toast}</div>}
    </CodeVenuePage>
  );
}

declare global {
  interface Window {
    __qaSetScenario?: (key: string) => void;
  }
}

function Root() {
  const [key, setKey] = useState(
    () => new URLSearchParams(window.location.search).get("scenario") ?? "mixed",
  );
  useEffect(() => {
    window.__qaSetScenario = (k: string) => setKey(k);
  }, []);
  return (
    <StrictMode>
      <MemoryRouter initialEntries={["/examiner-portal"]}>
        <QAApp key={key} scenarioKey={key} />
      </MemoryRouter>
    </StrictMode>
  );
}

createRoot(document.getElementById("root")!).render(<Root />);
