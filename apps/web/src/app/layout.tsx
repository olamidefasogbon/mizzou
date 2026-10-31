import type { Metadata, Viewport } from "next";
import { Inter, Kaushan_Script } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

// Wordmark face (user instruction + docs/design/README.md). The PNGs show a
// serif stand-in; the shipped wordmark is Pinyon Script.
const kaushan = Kaushan_Script({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-kaushan",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mizzou — from link to executed application",
  description: "Mizzou reads the official page, extracts dates and requirements with evidence, and builds your application plan. You approve every step.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${kaushan.variable}`}>
      <body>{children}</body>
    </html>
  );
}
