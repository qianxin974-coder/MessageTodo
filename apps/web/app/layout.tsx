import type { Metadata } from "next";
import "./globals.css";
import React from "react";

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#667eea',
};

export const metadata: Metadata = {
  title: "MessageTodo",
  description: "MessageTodo — turn any message into a todo with reminders",
  applicationName: "MessageTodo",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
