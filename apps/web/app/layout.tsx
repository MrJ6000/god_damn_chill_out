import "./globals.css";
import type { Metadata } from "next";
import { DemoBar } from "@/components/DemoBar";
import { DemoProvider } from "@/components/DemoProvider";

export const metadata: Metadata = {
  title: "PolicyVault Sentinel",
  description: "即使 AI 遭入侵，資金仍受安全規則保護。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant-TW">
      <body className="min-h-screen bg-ink text-body">
        <DemoProvider>
          <DemoBar />
          <div className="pt-[112px]">{children}</div>
        </DemoProvider>
      </body>
    </html>
  );
}
