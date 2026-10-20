import fs from "node:fs";
import type { Frame, Page } from "playwright";
import type { Applicant, Profile } from "../lib/types";
import { sleep } from "./portals/types";
import type { ApplyOutcome } from "./portals/types";

/**
 * Best-effort generic application-form filler for company career sites (Greenhouse / Lever / custom forms).
 *
 * Safety rules:
 *  - never creates accounts or signs in (password field => manual)
 *  - never solves CAPTCHAs (=> manual)
 *  - only fills fields it can answer from your saved details; if any REQUIRED field is left unanswered it stops
 *    WITHOUT submitting and reports which fields need you
 *  - legal consent boxes are ticked only if you opted in (Applicant.agreeToTerms)
 */

interface Field {
  id: string; // value of data-jaa attribute
  frame: number; // index into page.frames()
  tag: string;
  type: string;
  label: string; // lower-cased label text + name/id/placeholder
  required: boolean;
  empty: boolean;
  options: string[];
}

const manual = (note: string): ApplyOutcome => ({ status: "needs_manual", note });

// ---------- field scanning (runs inside the page) ----------
// Plain JS source string on purpose: tsx/esbuild would inject helpers (__name) into a real function
// that don't exist in the page context.

const SCAN_SRC = String.raw`(prefix) => {
  var visible = function (el) {
    var r = el.getBoundingClientRect();
    var s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  var labelOf = function (el) {
    var parts = [];
    var labelled = el.getAttribute("aria-labelledby");
    if (labelled) parts.push(labelled.split(" ").map(function (i) { var e = document.getElementById(i); return e ? e.innerText : ""; }).join(" "));
    if (el.labels && el.labels.length) parts.push(Array.prototype.map.call(el.labels, function (l) { return l.innerText; }).join(" "));
    parts.push(el.getAttribute("aria-label") || "", el.placeholder || "", el.name || "", el.id || "");
    // Only when the control has no label of its own: take the nearest wrapper that holds exactly this control.
    if (!(el.labels && el.labels.length) && !el.getAttribute("aria-label") && !labelled) {
      var p = el.parentElement;
      for (var i = 0; i < 3 && p; i++, p = p.parentElement) {
        if (p.querySelectorAll("input, textarea, select").length > 1 && p.querySelector("fieldset") !== p) continue;
        var l = p.querySelector("label, legend");
        if (l && l.innerText) { parts.push(l.innerText); break; }
      }
    }
    return parts.join(" | ").replace(/\s+/g, " ").toLowerCase().slice(0, 240);
  };
  var out = [];
  var n = 0;
  document.querySelectorAll("input, textarea, select").forEach(function (el) {
    var type = (el.type || el.tagName).toLowerCase();
    if (["hidden", "submit", "button", "image", "reset", "search"].indexOf(type) >= 0) return;
    if (el.disabled || el.readOnly) return;
    if (type !== "file" && !visible(el)) return;
    var id = prefix + n++;
    el.setAttribute("data-jaa", id);
    var label = labelOf(el);
    var tag = el.tagName.toLowerCase();
    var empty;
    if (type === "checkbox") empty = !el.checked;
    else if (type === "radio") empty = !document.querySelector('input[type=radio][name="' + el.name + '"]:checked');
    else if (type === "file") empty = !el.files || el.files.length === 0;
    else if (tag === "select") empty = !el.value || (el.selectedIndex <= 0 && /select|choose|--|please/i.test((el.options[0] && el.options[0].text) || ""));
    else empty = !el.value;
    out.push({
      id: id, tag: tag, type: type, label: label,
      required: el.required || el.getAttribute("aria-required") === "true" || /\*/.test(label),
      empty: empty,
      options: tag === "select" ? Array.prototype.map.call(el.options, function (o) { return o.text; }) : []
    });
  });
  return out;
}`;

async function scanAll(page: Page): Promise<Field[]> {
  const fields: Field[] = [];
  const frames = page.frames();
  for (let i = 0; i < frames.length; i++) {
    try {
      const found = (await frames[i].evaluate(`(${SCAN_SRC})(${JSON.stringify(`f${i}_`)})`)) as Omit<Field, "frame">[];
      fields.push(...found.map((f) => ({ ...f, frame: i })));
    } catch {
      /* cross-origin / detached frame */
    }
  }
  return fields;
}


// ---------- answering ----------

const RULES: [RegExp, (a: Applicant, years: number) => string][] = [
  [/first.?name|given.?name|fname/, (a) => a.firstName],
  [/last.?name|surname|family.?name|lname/, (a) => a.lastName],
  [/current (ctc|salary|compensation|package)|present (ctc|salary)|ctc.*current/, (a) => a.currentCtc],
  [/expected (ctc|salary|compensation|package)|desired (ctc|salary)|salary expectation|ctc.*expected/, (a) => a.expectedCtc],
  [/notice/, (a) => a.noticePeriod],
  [/current (company|employer|organi[sz]ation)|present (company|employer)|employer name/, (a) => a.currentCompany],
  [/total (work )?experience|years of (total |work |relevant )?experience|experience.*years|how many years/, (_a, y) => String(y)],
  [/e-?mail/, (a) => a.email],
  [/phone|mobile|contact (no|number)|telephone/, (a) => a.phone],
  [/linkedin/, (a) => a.linkedin],
  [/\b(city|current location|location|town)\b/, (a) => a.city],
  [/full.?name|your name|candidate name|\bname\b/, (a) => `${a.firstName} ${a.lastName}`.trim()],
];

function answerFor(f: Field, a: Applicant, years: number): string {
  if (f.type === "email") return a.email;
  if (f.type === "tel") return a.phone;
  for (const [re, get] of RULES) if (re.test(f.label)) return get(a, years);
  return "";
}

const CONSENT = /agree|consent|privacy|terms|accept|acknowledge|gdpr|policy|declaration/;

async function fillForm(page: Page, fields: Field[], profile: Profile): Promise<void> {
  const a = profile.applicant;
  const frames = page.frames();
  const fileCount = fields.filter((f) => f.type === "file").length;

  for (const f of fields) {
    const loc = frames[f.frame].locator(`[data-jaa="${f.id}"]`).first();
    try {
      if (f.type === "file") {
        const isResume = /resume|cv|curriculum/.test(f.label) || (fileCount === 1 && !/cover/.test(f.label));
        if (f.empty && isResume && profile.resumePath && fs.existsSync(profile.resumePath)) {
          await loc.setInputFiles(profile.resumePath);
        }
      } else if (f.type === "checkbox") {
        if (f.empty && CONSENT.test(f.label) && a.agreeToTerms) await loc.check({ force: true });
      } else if (f.type === "radio") {
        // never guess answers to choice questions
      } else if (f.tag === "select") {
        const want = answerFor(f, a, profile.yearsExperience).toLowerCase();
        if (f.empty && want) {
          const opt = f.options.find((o) => o.toLowerCase().includes(want));
          if (opt) await loc.selectOption({ label: opt });
        }
      } else if (f.empty) {
        const value = answerFor(f, a, profile.yearsExperience);
        if (value) await loc.fill(value);
      }
    } catch {
      /* field vanished / not interactable: caught by the missing-field check below */
    }
  }
}

// ---------- page-level checks ----------

async function hasCaptcha(page: Page): Promise<boolean> {
  const sel = ".g-recaptcha, .h-captcha, iframe[src*='hcaptcha.com'], iframe[title*='recaptcha challenge' i], iframe[src*='challenges.cloudflare.com']";
  if (await page.locator(sel).first().isVisible().catch(() => false)) return true;
  return page.getByText(/verify (that )?you are (a )?human/i).first().isVisible().catch(() => false);
}

async function anyVisible(page: Page, pick: (fr: Frame) => ReturnType<Frame["locator"]>): Promise<boolean> {
  for (const fr of page.frames()) {
    if (await pick(fr).first().isVisible().catch(() => false)) return true;
  }
  return false;
}

const SUCCESS =
  /thank you for (applying|your (application|interest))|application (has been |was )?(submitted|received|sent)|successfully (submitted|applied)|we('| ha)ve received your application/i;

async function clickFirst(page: Page, name: RegExp): Promise<boolean> {
  for (const fr of page.frames()) {
    for (const role of ["button", "link"] as const) {
      const el = fr.getByRole(role, { name }).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click({ timeout: 8000 }).catch(() => {});
        return true;
      }
    }
  }
  return false;
}

// ---------- main entry ----------

/** `page` must already be on the company's job/application page. */
export async function applyOnCompanySite(startPage: Page, profile: Profile): Promise<ApplyOutcome> {
  let page = startPage;
  const a = profile.applicant;
  if (!a.email || !a.phone || !(a.firstName || profile.name)) {
    return manual("Add your name, email and phone in Profile & Settings so company forms can be filled");
  }

  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await sleep(3000);
  // Decline optional cookies if a banner is in the way (never "accept all").
  await clickFirst(page, /^(reject all|decline( all)?|only necessary|necessary only|reject)$/i);

  for (let step = 0; step < 8; step++) {
    if (page.isClosed()) return manual("Company site closed unexpectedly");
    if (await hasCaptcha(page)) return manual(`CAPTCHA on company site: ${page.url()}`);

    let fields = await scanAll(page);
    if (fields.some((f) => f.type === "password")) {
      return manual(`Company site needs an account / sign-in: ${page.url()}`);
    }

    // On a plain job-description page: open the application form first.
    if (fields.length < 2) {
      const before = page.context().pages().length;
      const clicked = await clickFirst(page, /^\s*(apply( now| here| for this (job|position|role))?|i'?m interested)\s*$/i);
      if (!clicked) return manual(`No application form found on company site: ${page.url()}`);
      await sleep(3000);
      const pages = page.context().pages();
      if (pages.length > before) page = pages[pages.length - 1];
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      continue;
    }

    await fillForm(page, fields, profile);
    await sleep(800);

    fields = await scanAll(page);
    const missing = fields.filter((f) => f.required && f.empty && f.type !== "radio");
    const radioGroups = new Set(fields.filter((f) => f.type === "radio" && f.required && f.empty).map((f) => f.label));
    if (missing.length || radioGroups.size) {
      const names = [...missing.map((f) => f.label.split("|")[0].trim() || f.type), ...radioGroups]
        .map((s) => s.slice(0, 40))
        .slice(0, 5);
      return manual(`Company form needs your input (${names.join("; ")}): ${page.url()}`);
    }

    if (await clickFirst(page, /^(submit( application)?|send application|apply|finish|complete application)$/i)) {
      for (let i = 0; i < 10; i++) {
        await sleep(1000);
        if (await anyVisible(page, (fr) => fr.getByText(SUCCESS))) return { status: "applied" };
      }
      return manual(`Submitted but could not confirm; check the company site: ${page.url()}`);
    }
    if (await clickFirst(page, /^(next|continue|save and continue|save & continue|review)/i)) {
      await sleep(3000);
      continue;
    }
    return manual(`No submit button found on company form: ${page.url()}`);
  }
  return manual(`Company form has too many steps: ${page.url()}`);
}
