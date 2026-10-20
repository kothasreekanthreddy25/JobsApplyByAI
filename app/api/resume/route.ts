import { NextResponse } from "next/server";
import { resumeFileToText, saveResumeFile } from "@/lib/resumeFile";
import { profileFromResume } from "@/lib/resumeProfile";
import { getProfile, saveProfile } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const file = (await req.formData()).get("resume");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  try {
    const profile = profileFromResume(await resumeFileToText(file), getProfile());
    profile.resumePath = await saveResumeFile(file);
    saveProfile(profile);
    return NextResponse.json(profile);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
}
