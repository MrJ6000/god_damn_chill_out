import "./globals.css";
import type { Metadata } from "next";
import { DemoBar } from "@/components/DemoBar";

export const metadata: Metadata = {
  title: "PolicyVault Sentinel",
  description: "Assume the AI is compromised. Prove the money is still safe.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink text-body">
        <DemoBar />
        <div className="pt-[88px]">{children}</div>
      </body>
    </html>
  );
}
