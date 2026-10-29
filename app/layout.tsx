import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "无痕修图 · 本地照片去水印",
  description: "在本机浏览器内标记并修复照片水印，照片无需上传。",
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
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
