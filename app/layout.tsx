import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Feud Night — Big guesses. Bigger bragging rights.",
  description: "Your next game night starts here. Play live survey-style battles with friends, fresh AI questions, and solo or team modes.",
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
