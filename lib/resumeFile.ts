/** Extracts plain text from an uploaded PDF / DOCX / TXT resume. Throws Error with a user-facing message. */
export async function resumeFileToText(file: File): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = file.name.toLowerCase().split(".").pop();
  let text = "";
  try {
    if (ext === "pdf") {
      const pdf = (await import("pdf-parse/lib/pdf-parse.js")).default;
      text = (await pdf(buf)).text;
    } else if (ext === "docx") {
      text = (await (await import("mammoth")).extractRawText({ buffer: buf })).value;
    } else if (ext === "txt" || ext === "md") {
      text = buf.toString("utf8");
    } else {
      throw new Error("Upload a PDF, DOCX or TXT file");
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Upload")) throw e;
    throw new Error("Could not read that file");
  }
  if (text.trim().length < 50) throw new Error("No text found (scanned PDF?). Try DOCX/TXT.");
  return text;
}

/** Keeps a copy of the uploaded resume so it can be attached to company-site applications. */
export async function saveResumeFile(file: File): Promise<string> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const ext = (file.name.toLowerCase().split(".").pop() || "pdf").replace(/[^a-z0-9]/g, "");
  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `resume.${ext}`);
  fs.writeFileSync(target, Buffer.from(await file.arrayBuffer()));
  return target;
}
