import { NextResponse } from "next/server";
import { getDb } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  const db = getDb();
  const applications = [...db.applications].sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
  return NextResponse.json({ applications, lastRun: db.runs[db.runs.length - 1] ?? null });
}
