import type { Metadata, Viewport } from "next";
import { AppProvider } from "@/components/provider";
import { Shell } from "@/components/shell";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "Perkkeep — your benefits, together",
    template: "%s · Perkkeep",
  },
  description:
    "A private, history-preserving home for your credit card benefits.",
  applicationName: "Perkkeep",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Perkkeep" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f6f5f1",
  viewportFit: "cover",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AppProvider>
          <Shell>{children}</Shell>
        </AppProvider>
      </body>
    </html>
  );
}
