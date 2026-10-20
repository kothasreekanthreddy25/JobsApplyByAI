import { NextResponse } from "next/server";
import { spawnScript } from "@/lib/spawnScript";
import { getDb } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Starts the agent as a detached process so the browser automation outlives the request. */
export function POST() {
  const last = getDb().runs.at(-1);
  if (last && !last.finishedAt && Date.now() - Date.parse(last.startedAt) < 60 * 60 * 1000) {
    return NextResponse.json({ error: "A run is already in progress" }, { status: 409 });
  }
  spawnScript("agent:run", [], "agent.log");
  return NextResponse.json({ started: true });
}
