import type { Metadata } from "next";
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
    "TripWire guards agent tool execution with deterministic policy controls and behavioral anomaly detection on edge and Node runtimes."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
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
