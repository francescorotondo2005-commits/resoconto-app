import "./globals.css";

export const metadata = {
  title: "Resoconto — Value Betting System",
  description: "Sistema di analisi quantitativa per il trading sportivo",
};

export default function RootLayout({ children }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
