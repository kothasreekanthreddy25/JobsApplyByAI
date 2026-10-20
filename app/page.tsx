import { redirect } from "next/navigation";
import { getConnections, getCredentialSummary, getProfile } from "@/lib/store";

export const dynamic = "force-dynamic";

/** First visit goes to the onboarding form; afterwards straight to the dashboard. */
export default function Home() {
  const p = getProfile();
  const creds = getCredentialSummary();
  const conns = getConnections();
  const onboarded =
    p.resumeText.length > 50 && ["naukri", "linkedin", "monster"].some((k) => creds[k] || conns[k]);
  redirect(onboarded ? "/dashboard" : "/setup");
}
