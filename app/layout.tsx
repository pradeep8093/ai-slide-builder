import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Slide Builder",
  description: "Build presentations with AI and a real canvas editor.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full">{children}</body>
    </html>
  );
}

