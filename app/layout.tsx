import type { Metadata } from "next";
import { QUESTION_BANK_COUNT } from "../lib/constants";
import "./globals.css";

export const metadata: Metadata = {
  title: "Feud Night — Big guesses. Bigger bragging rights.",
  description: `Your next game night starts here. Play survey-style battles with friends, ${QUESTION_BANK_COUNT.toLocaleString("en-US")} ready-to-play rounds, and solo or team modes.`,
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
