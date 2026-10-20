import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Job Apply Agent",
  description: "Daily job application agent for Naukri, LinkedIn and Monster",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="nav">
          <strong>Job Apply Agent</strong>
          <nav>
            <Link href="/dashboard">Applications</Link>
            <Link href="/setup">Setup</Link>
            <Link href="/settings">Profile &amp; Settings</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
