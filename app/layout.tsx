import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cerber",
  description: "Sprawy zgłaszane do spółdzielni mieszkaniowej: oś czasu, terminy, regulaminy.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
