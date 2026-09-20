'use client';
import React from 'react';
import { ThemeProvider, ToastProvider, InstallPrompt } from '@messagetodo/design-system';
import { AppShell } from '../components/AppShell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider config={{ colorScheme: 'light', persistPreference: false }}>
      <ToastProvider>
        <AppShell>{children}</AppShell>
        <InstallPrompt />
      </ToastProvider>
    </ThemeProvider>
  );
}
