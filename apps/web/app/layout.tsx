import type { Metadata } from "next";
import Script from "next/script";
import { Barlow_Condensed, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: "700",
  variable: "--font-display"
});

const body = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-body"
});

export const metadata: Metadata = {
  title: "TripWire Guard | Agentic Tool Call Security",
  description:
    "TripWire guards agent tool execution with deterministic policy controls and behavioral anomaly detection on edge and Node runtimes.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" }
    ],
    apple: "/apple-touch-icon.png"
  },
  manifest: "/site.webmanifest"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <body>
        <Script
          src="https://umami-production-e1ca.up.railway.app/script.js"
          data-website-id="8709c006-92bc-4b0e-b16b-c5c1db30969f"
          strategy="afterInteractive"
        />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('tripwire-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}"
          }}
        />
        {children}
      </body>
    </html>
  );
}
