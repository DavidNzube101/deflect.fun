import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deflect Game",
  description: "Swipe to survive. Collect powerups. Dominate.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}